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
import { getTimeoutTask, maskProperties, shuffleList, sleep } from "../../utils/utils";
import { HostRole } from "../../host_role";
import { HostAvailability } from "../../host_availability/host_availability";
import { AwsWrapperError, InternalQueryTimeoutError } from "../../utils/errors";
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

  async failover(hosts: HostInfo[], currentHost: HostInfo | null): Promise<ReaderFailoverResult> {
    if (hosts == null || hosts.length === 0) {
      logger.info(Messages.get("ClusterAwareReaderFailoverHandler.invalidTopology", "failover"));
      return ClusterAwareReaderFailoverHandler.FAILED_READER_FAILOVER_RESULT;
    }
    return await this.failoverTask(hosts, currentHost);
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

    const timeoutTask = getTimeoutTask(timer, "Internal failover task timed out.", this.maxFailoverTimeoutMs);
    const failoverTask = this.internalFailoverTask(hosts, currentHost, endTime);

    return await Promise.race([timeoutTask, failoverTask])
      .then((result) => {
        if (result) {
          return result;
        }
        // Should not enter here.
        return new ReaderFailoverResult(null, null, false, new AwsWrapperError("Failover task returned unexpected value"));
      })
      .catch((error) => {
        return new ReaderFailoverResult(null, null, false, error instanceof InternalQueryTimeoutError ? error : new AwsWrapperError(error));
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
    throw new InternalQueryTimeoutError("Internal failover task has timed out.");
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
          return result;
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

    return new ReaderFailoverResult(null, null, false);
  }

  async getResultFromNextTaskBatch(hosts: HostInfo[], i: number): Promise<ReaderFailoverResult> {
    const timer: any = {};
    const timeoutTask = getTimeoutTask(timer, "Connection attempt task timed out.", this.timeoutMs);

    const numTasks = i + 1 < hosts.length ? 2 : 1;
    const getResultTask = this.getResultTask(hosts, numTasks, i);

    return await Promise.race([timeoutTask, getResultTask])
      .then((result) => {
        if (result) {
          return result;
        }
        throw new AwsWrapperError("Connection attempt task timed out.");
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
    let selectedTask = -1;
    const firstTask = new ConnectionAttemptTask(this.initialConnectionProps, this.pluginService, hosts[i], i);
    tasks.push(firstTask.call());
    let secondTask: ConnectionAttemptTask;
    if (numTasks === 2) {
      secondTask = new ConnectionAttemptTask(this.initialConnectionProps, this.pluginService, hosts[i + 1], i + 1);
      tasks.push(secondTask.call());
    }

    return await Promise.any(tasks)
      .then(async (result) => {
        if (numTasks === 2 && !result.isConnected) {
          if (result.taskId === i) {
            selectedTask = i;
            return await tasks[1];
          } else if (result.taskId === i + 1) {
            selectedTask = i + 1;
            return await tasks[0];
          }
        }
        return result;
      })
      .finally(() => {
        firstTask.selectedTask = selectedTask;
        secondTask.selectedTask = selectedTask;
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
  targetClient: any;
  taskId: number;
  selectedTask: number;

  constructor(initialConnectionProps: Map<string, any>, pluginService: PluginService, newHost: HostInfo, taskId: number) {
    this.initialConnectionProps = initialConnectionProps;
    this.pluginService = pluginService;
    this.newHost = newHost;
    this.taskId = taskId;
    this.selectedTask = taskId;
  }

  async call(): Promise<ReaderFailoverResult> {
    const copy = new Map(this.initialConnectionProps);
    copy.set(WrapperProperties.HOST.name, this.newHost.host);
    logger.info(
      Messages.get(
        "ClusterAwareReaderFailoverHandler.attemptingReaderConnection",
        this.newHost.host,
        JSON.stringify(Object.fromEntries(maskProperties(copy)))
      )
    );
    try {
      this.targetClient = await this.pluginService.forceConnect(this.newHost, copy);
      this.pluginService.setAvailability(this.newHost.allAliases, HostAvailability.AVAILABLE);
      logger.info(Messages.get("ClusterAwareReaderFailoverHandler.successfulReaderConnection", this.newHost.host));
      return new ReaderFailoverResult(this.targetClient, this.newHost, true, undefined, this.taskId);
    } catch (error) {
      this.selectedTask = -1;
      this.pluginService.setAvailability(this.newHost.allAliases, HostAvailability.NOT_AVAILABLE);
      if (error instanceof Error) {
        // Propagate exceptions that are not caused by network errors.
        if (!this.pluginService.isNetworkError(error)) {
          return new ReaderFailoverResult(null, null, false, error, this.taskId);
        }

        return new ReaderFailoverResult(null, null, false, undefined, this.taskId);
      }
      throw error;
    } finally {
      await this.performFinalCleanup();
    }
  }

  async performFinalCleanup() {
    if (this.selectedTask !== this.taskId) {
      await this.pluginService.tryClosingTargetClient(this.targetClient);
    }
  }
}
