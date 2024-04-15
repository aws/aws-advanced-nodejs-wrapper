/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { HostInfo } from "../../host_info";
import { PluginService } from "../../plugin_service";
import { ReaderFailoverResult } from "./reader_failover_result";
import { sleep, shuffleList } from "../../utils/utils";
import { HostRole } from "../../host_role";
import { HostAvailability } from "../../host_availability/host_availability";
import { AwsWrapperError } from "../../utils/errors";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";

export interface ReaderFailoverHandler {
  failover(hosts: HostInfo[], currentHost: HostInfo): Promise<ReaderFailoverResult>;

  getReaderConnection(hostList: HostInfo[]): Promise<ReaderFailoverResult>;
}

export class ClusterAwareReaderFailoverHandler implements ReaderFailoverHandler {
  private static readonly FAILED_READER_FAILOVER_RESULT = new ReaderFailoverResult(null, null, false);
  static readonly DEFAULT_FAILOVER_TIMEOUT = 60000; // 60 sec
  static readonly DEFAULT_READER_CONNECT_TIMEOUT = 30000; // 30 sec
  private initialConnectionProps: Map<string, any>;
  private maxFailoverTimeoutMs: number;
  private timeoutMs: number;
  private enableFailoverStrictReader: boolean;
  private pluginService: PluginService;

  constructor(
    pluginService: PluginService,
    initialConnectionProps: Map<string, any>,
    maxFailoverTimeoutMs: number,
    timeoutMs: number,
    enableFailoverStrictReader: boolean
  ) {
    this.pluginService = pluginService;
    this.initialConnectionProps = initialConnectionProps;
    this.maxFailoverTimeoutMs = maxFailoverTimeoutMs;
    this.timeoutMs = timeoutMs;
    this.enableFailoverStrictReader = enableFailoverStrictReader;
  }

  getTimeoutTask(timer: any, message: string, timeoutValue: number): Promise<void> {
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(message);
      }, timeoutValue);
    });
  }

  async failover(hosts: HostInfo[], currentHost: HostInfo): Promise<ReaderFailoverResult> {
    if (hosts == null || hosts.length === 0) {
      logger.info(Messages.get("ClusterAwareReaderFailoverHandler.invalidTopology", "failover"));
      return ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT;
    }
    return this.failoverTask(hosts, currentHost).catch((error) => {
      return new ReaderFailoverResult(null, null, false, error);
    });
  }

  async getReaderConnection(hostList: HostInfo[]): Promise<ReaderFailoverResult> {
    if (hostList == null) {
      logger.info(Messages.get("ClusterAwareReaderFailoverHandler.invalidTopology", "getReaderConnection"));
      return Promise.resolve(ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT);
    }

    const hostsByPriority = this.getReaderHostsByPriority(hostList);
    return this.getConnectionFromHostGroup(hostsByPriority, 0).catch((error) => {
      return new ReaderFailoverResult(null, null, false, error);
    });
  }

  async failoverTask(hosts: HostInfo[], currentHost: HostInfo): Promise<ReaderFailoverResult> {
    let timer: any;
    const endTime = Date.now() + this.maxFailoverTimeoutMs;

    const timeoutTask = this.getTimeoutTask(timer, "Internal failover task timed out.", this.maxFailoverTimeoutMs);
    const failoverTask = this.internalFailoverTask(hosts, currentHost, endTime);

    return Promise.race([timeoutTask, failoverTask])
      .then((result) => {
        if (result instanceof ReaderFailoverResult) {
          return result;
        } else {
          throw new AwsWrapperError("Resolved result was not a ReaderFailoverResult.");
        }
      })
      .catch((error) => {
        throw new AwsWrapperError(error);
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }

  async internalFailoverTask(hosts: HostInfo[], currentHost: HostInfo, endTime: number): Promise<ReaderFailoverResult> {
    while (Date.now() <= endTime) {
      const result = await this.failoverInternal(hosts, currentHost);
      if (result instanceof ReaderFailoverResult && result.client && result.newHost && result.isConnected) {
        if (!this.enableFailoverStrictReader) {
          return result; // connection to any host is acceptable
        }

        // ensure new connection is to a reader host
        this.pluginService.refreshHostList();
        const topology = this.pluginService.getHosts();

        for (let i = 0; i < topology.length; i++) {
          const host = topology[i];
          if (host.host === result.newHost.host) {
            // found new connection host in the latest topology
            if (host.role === HostRole.READER) {
              return result;
            }
          }
        }

        // New host is not found in the latest topology. There are few possible reasons for that.
        // - Host is not yet presented in the topology due to failover process in progress
        // - Host is in the topology but its role isn't a
        //   READER (that is not acceptable option due to this.strictReader setting)
        // Need to continue this loop and to make another try to connect to a reader.

        try {
          await result.client.end();
        } catch (error) {
          // ignore
        }
        await sleep(1000);
      } else {
        await sleep(1000);
      }
    }
    throw new AwsWrapperError("Internal failover task has timed out.");
  }

  async failoverInternal(hosts: HostInfo[], currentHost: HostInfo): Promise<ReaderFailoverResult> {
    if (currentHost) {
      this.pluginService.setAvailability(currentHost.allAliases, HostAvailability.NOT_AVAILABLE);
    }
    const hostsByPriority = this.getHostsByPriority(hosts);
    return this.getConnectionFromHostGroup(hostsByPriority, 0);
  }

  async getConnectionFromHostGroup(hosts: HostInfo[], i: number): Promise<ReaderFailoverResult> {
    if (i >= hosts.length) {
      return ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT;
    }

    for (let i = 0; i < hosts.length; i += 2) {
      // submit connection attempt tasks in batches of 2
      try {
        const result = await this.getResultFromNextTaskBatch(hosts, i);
        if (result && (result.isConnected || result.exception)) {
          return Promise.resolve(result);
        }
      } catch (error) {
        if (error instanceof AggregateError && error.message.includes("All promises were rejected")) {
          // ignore and try the next batch
        } else {
          throw error;
        }
      }

      await sleep(1000);
    }

    return Promise.resolve(new ReaderFailoverResult(null, null, false));
  }

  async getResultFromNextTaskBatch(hosts: HostInfo[], i: number): Promise<ReaderFailoverResult> {
    let timer: any;
    const timeoutTask = this.getTimeoutTask(timer, "Connection attempt task timed out.", this.timeoutMs);

    const getResultTask = new Promise((resolve, reject) => {
      const numTasks = i + 1 < hosts.length ? 2 : 1;
      const tasks = [];
      const task1 = this.connectionAttemptTask(hosts[i]);
      tasks.push(task1);
      if (numTasks === 2) {
        const task2 = this.connectionAttemptTask(hosts[i + 1]);
        tasks.push(task2);
      }

      Promise.any(tasks)
        .then((result) => {
          resolve(result);
        })
        .catch((error) => {
          if (error instanceof AwsWrapperError) {
            // Propagate exceptions that are not caused by network errors.
            if (!this.pluginService.isNetworkError(error)) {
              return resolve(new ReaderFailoverResult(null, null, false, error));
            }

            return resolve(ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT);
          }
          return reject(error);
        });
    });

    return Promise.race([timeoutTask, getResultTask])
      .then((result) => {
        if (result instanceof ReaderFailoverResult) {
          return result;
        } else {
          throw new AwsWrapperError("Resolved result was not a ReaderFailoverResult.");
        }
      })
      .catch((error) => {
        if (error instanceof AggregateError && error.message.includes("All promises were rejected")) {
          // ignore so the next task batch can be attempted
          return ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT;
        }
        throw new AwsWrapperError(error);
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }

  async connectionAttemptTask(newHost: HostInfo): Promise<ReaderFailoverResult> {
    logger.info(
      Messages.get(
        "ClusterAwareReaderFailoverHandler.attemptingReaderConnection",
        newHost.host,
        JSON.stringify(Object.fromEntries(this.initialConnectionProps))
      )
    );
    const copy = new Map(this.initialConnectionProps);
    return this.pluginService
      .createTargetClientAndConnect(newHost, copy)
      .then((newClient) => {
        this.pluginService.setAvailability(newHost.allAliases, HostAvailability.AVAILABLE);
        logger.info(Messages.get("ClusterAwareReaderFailoverHandler.successfulReaderConnection", newHost.host));
        if (newClient) {
          return new ReaderFailoverResult(newClient, newHost, true);
        } else {
          throw new AwsWrapperError("New client was not obtained from 'createTargetClientAndConnect'.");
        }
      })
      .catch((error) => {
        logger.info(Messages.get("ClusterAwareReaderFailoverHandler.failedReaderConnection", newHost.host));
        if (error instanceof AwsWrapperError) {
          this.pluginService.setAvailability(newHost.allAliases, HostAvailability.NOT_AVAILABLE);
        }
        throw error;
      });
  }

  getReaderHostsByPriority(hosts: HostInfo[]): HostInfo[] {
    const activeReaders: HostInfo[] = [];
    const downHostList: HostInfo[] = [];

    hosts.forEach((host) => {
      if (host.role === HostRole.WRITER) {
        return;
      }

      if (host.availability === HostAvailability.AVAILABLE) {
        activeReaders.push(host);
      } else {
        downHostList.push(host);
      }
    });

    shuffleList(activeReaders);
    shuffleList(downHostList);

    const hostsByPriority: HostInfo[] = [...activeReaders];
    hostsByPriority.push(...downHostList);

    return hostsByPriority;
  }

  getHostsByPriority(hosts: HostInfo[]): HostInfo[] {
    const activeReaders: HostInfo[] = [];
    const downHostList: HostInfo[] = [];
    let writerHost: HostInfo | undefined;
    hosts.forEach((host) => {
      if (host.role === HostRole.WRITER) {
        writerHost = host;
        return;
      }

      if (host.availability === HostAvailability.AVAILABLE) {
        activeReaders.push(host);
      } else {
        downHostList.push(host);
      }
    });

    shuffleList(activeReaders);
    shuffleList(downHostList);

    const hostsByPriority: HostInfo[] = [...activeReaders];
    const numReaders: number = activeReaders.length + downHostList.length;
    if (writerHost && (!this.enableFailoverStrictReader || numReaders === 0)) {
      hostsByPriority.push(writerHost);
    }
    hostsByPriority.push(...downHostList);

    return hostsByPriority;
  }
}
