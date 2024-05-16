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
import { shuffleList, sleep } from "../../utils/utils";
import { HostRole } from "../../host_role";
import { HostAvailability } from "../../host_availability/host_availability";
import { AwsWrapperError } from "../../utils/errors";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { WrapperProperties } from "../../wrapper_property";

export interface ReaderFailoverHandler {
  failover(hosts: HostInfo[], currentHost: HostInfo): Promise<ReaderFailoverResult>;

  getReaderConnection(hostList: HostInfo[]): Promise<ReaderFailoverResult>;
}

export class ClusterAwareReaderFailoverHandler implements ReaderFailoverHandler {
  static readonly FAILED_READER_FAILOVER_RESULT = new ReaderFailoverResult(null, null, false);
  static readonly DEFAULT_FAILOVER_TIMEOUT = 60000; // 60 sec
  static readonly DEFAULT_READER_CONNECT_TIMEOUT = 30000; // 30 sec
  private readonly initialConnectionProps: Map<string, any>;
  private readonly maxFailoverTimeoutMs: number;
  private readonly timeoutMs: number;
  private readonly enableFailoverStrictReader: boolean;
  private readonly pluginService: PluginService;

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

  private getTimeoutTask(timer: any, message: string, timeoutValue: number): Promise<void> {
    return new Promise((_resolve, reject) => {
      timer.timeoutId = setTimeout(() => {
        reject(message);
      }, timeoutValue);
    });
  }

  async failover(hosts: HostInfo[], currentHost: HostInfo | null): Promise<ReaderFailoverResult> {
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
    return await this.getConnectionFromHostGroup(hostsByPriority).catch((error) => {
      return new ReaderFailoverResult(null, null, false, error);
    });
  }

  async failoverTask(hosts: HostInfo[], currentHost: HostInfo | null): Promise<ReaderFailoverResult> {
    const timer: any = {};
    const endTime = Date.now() + this.maxFailoverTimeoutMs;

    const timeoutTask = this.getTimeoutTask(timer, "Internal failover task timed out.", this.maxFailoverTimeoutMs);
    const failoverTask = this.internalFailoverTask(hosts, currentHost, endTime);

    return Promise.race([timeoutTask, failoverTask])
      .then((result) => {
        if (result instanceof ReaderFailoverResult) {
          return result;
        }
        throw new AwsWrapperError("Resolved result was not a ReaderFailoverResult.");
      })
      .catch((error) => {
        throw new AwsWrapperError(error);
      })
      .finally(() => {
        clearTimeout(timer.timeoutId);
      });
  }

  async internalFailoverTask(hosts: HostInfo[], currentHost: HostInfo | null, endTime: number): Promise<ReaderFailoverResult> {
    while (Date.now() <= endTime) {
      const result = await this.failoverInternal(hosts, currentHost);
      if (result.client && result.newHost && result.isConnected) {
        if (!this.enableFailoverStrictReader) {
          return result; // connection to any host is acceptable
        }

        // ensure new connection is to a reader host
        await this.pluginService.refreshHostList();
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
          await this.pluginService.tryClosingTargetClient(result.client);
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

  async failoverInternal(hosts: HostInfo[], currentHost: HostInfo | null): Promise<ReaderFailoverResult> {
    if (currentHost) {
      this.pluginService.setAvailability(currentHost.allAliases, HostAvailability.NOT_AVAILABLE);
    }
    const hostsByPriority = this.getHostsByPriority(hosts);
    return this.getConnectionFromHostGroup(hostsByPriority);
  }

  async getConnectionFromHostGroup(hosts: HostInfo[]): Promise<ReaderFailoverResult> {
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
    const timer: any = {};
    const timeoutTask = this.getTimeoutTask(timer, "Connection attempt task timed out.", this.timeoutMs);

    const numTasks = i + 1 < hosts.length ? 2 : 1;
    const getResultTask = this.getResultTask(hosts, numTasks, i);

    return Promise.race([timeoutTask, getResultTask])
      .then((result) => {
        if (result instanceof ReaderFailoverResult) {
          return result;
        }
        throw new AwsWrapperError("Resolved result was not a ReaderFailoverResult.");
      })
      .catch((error) => {
        if (error instanceof AggregateError && error.message.includes("All promises were rejected")) {
          // ignore so the next task batch can be attempted
          return ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT;
        }
        throw error;
      })
      .finally(() => {
        clearTimeout(timer.timeoutId);
      });
  }

  async getResultTask(hosts: HostInfo[], numTasks: number, i: number) {
    const tasks: Promise<ReaderFailoverResult>[] = [];
    let selectedTask = 0;
    const firstTask = new ConnectionAttemptTask(this.initialConnectionProps, this.pluginService, hosts[i]);
    tasks.push(firstTask.call());
    let secondTask: ConnectionAttemptTask;
    if (numTasks === 2) {
      secondTask = new ConnectionAttemptTask(this.initialConnectionProps, this.pluginService, hosts[i + 1]);
      tasks.push(secondTask.call());
    }

    return Promise.any(tasks)
      .then((result) => {
        if (numTasks === 2 && !result.isConnected) {
          if (firstTask.taskComplete) {
            selectedTask = 1;
            return tasks[1];
          } else if (secondTask.taskComplete) {
            selectedTask = 0;
            return tasks[0];
          }
        }
        return tasks[0];
      })
      .finally(() => {
        if (selectedTask === 0) {
          secondTask.performFinalCleanup();
        } else if (selectedTask === 1) {
          firstTask.performFinalCleanup();
        }
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

class ConnectionAttemptTask {
  initialConnectionProps: Map<string, any>;
  pluginService: PluginService;
  newHost: HostInfo;
  taskComplete: boolean = false;
  targetClient: any;

  constructor(initialConnectionProps: Map<string, any>, pluginService: PluginService, newHost: HostInfo) {
    this.initialConnectionProps = initialConnectionProps;
    this.pluginService = pluginService;
    this.newHost = newHost;
  }

  async call(): Promise<ReaderFailoverResult> {
    logger.info(
      Messages.get(
        "ClusterAwareReaderFailoverHandler.attemptingReaderConnection",
        this.newHost.host,
        JSON.stringify(Object.fromEntries(this.initialConnectionProps))
      )
    );
    const copy = new Map(this.initialConnectionProps);
    copy.set(WrapperProperties.HOST.name, this.newHost.host);
    try {
      this.targetClient = await this.pluginService.createTargetClient(copy);
      const connectFunc = this.pluginService.getConnectFunc(this.targetClient);
      await this.pluginService.forceConnect(this.newHost, this.initialConnectionProps, connectFunc);
      this.pluginService.setAvailability(this.newHost.allAliases, HostAvailability.AVAILABLE);
      logger.info(Messages.get("ClusterAwareReaderFailoverHandler.successfulReaderConnection", this.newHost.host));
      return new ReaderFailoverResult(this.targetClient, this.newHost, true);
    } catch (error) {
      if (error instanceof Error) {
        // Propagate exceptions that are not caused by network errors.
        if (!this.pluginService.isNetworkError(error)) {
          return new ReaderFailoverResult(null, null, false, error);
        }

        return ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT;
      }
      throw error;
    } finally {
      this.taskComplete = true;
    }
  }

  async performFinalCleanup() {
    await this.pluginService.tryClosingTargetClient(this.targetClient);
  }
}
