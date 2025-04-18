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
import { WriterFailoverResult } from "./writer_failover_result";
import { ClusterAwareReaderFailoverHandler } from "./reader_failover_handler";
import { PluginService } from "../../plugin_service";
import { HostAvailability } from "../../host_availability/host_availability";
import { AwsWrapperError } from "../../utils/errors";
import { getWriter, logTopology, maskProperties } from "../../utils/utils";
import { ReaderFailoverResult } from "./reader_failover_result";
import { Messages } from "../../utils/messages";
import { logger } from "../../../logutils";
import { WrapperProperties } from "../../wrapper_property";
import { ClientWrapper } from "../../client_wrapper";
import { FailoverRestriction } from "./failover_restriction";

export interface WriterFailoverHandler {
  failover(currentTopology: HostInfo[]): Promise<WriterFailoverResult>;
}

function isCurrentHostWriter(topology: HostInfo[], originalWriterHost: HostInfo): boolean {
  const latestWriter = getWriter(topology);
  const latestWriterAllAliases = latestWriter?.allAliases;
  const currentAliases = originalWriterHost.allAliases;
  if (currentAliases && latestWriterAllAliases) {
    return [...currentAliases].filter((alias) => latestWriterAllAliases.has(alias)).length > 0;
  }
  return false;
}

export class ClusterAwareWriterFailoverHandler implements WriterFailoverHandler {
  static readonly DEFAULT_RESULT = new WriterFailoverResult(false, false, [], "None", null);
  static readonly RECONNECT_WRITER_TASK = "TaskA";
  static readonly WAIT_NEW_WRITER_TASK = "TaskB";
  private readonly pluginService: PluginService;
  private readonly readerFailoverHandler: ClusterAwareReaderFailoverHandler;
  private readonly initialConnectionProps: Map<string, any>;
  maxFailoverTimeoutMs = 60000; // 60 sec
  readTopologyIntervalMs = 5000; // 5 sec
  reconnectionWriterIntervalMs = 5000; // 5 sec

  constructor(
    pluginService: PluginService,
    readerFailoverHandler: ClusterAwareReaderFailoverHandler,
    initialConnectionProps: Map<string, any>,
    failoverTimeoutMs?: number,
    readTopologyIntervalMs?: number,
    reconnectWriterIntervalMs?: number
  ) {
    this.pluginService = pluginService;
    this.readerFailoverHandler = readerFailoverHandler;
    this.initialConnectionProps = initialConnectionProps;
    this.maxFailoverTimeoutMs = failoverTimeoutMs ?? this.maxFailoverTimeoutMs;
    this.readTopologyIntervalMs = readTopologyIntervalMs ?? this.readTopologyIntervalMs;
    this.reconnectionWriterIntervalMs = reconnectWriterIntervalMs ?? this.reconnectionWriterIntervalMs;
  }

  async failover(currentTopology: HostInfo[]): Promise<WriterFailoverResult> {
    if (!currentTopology || currentTopology.length == 0) {
      logger.error(Messages.get("ClusterAwareWriterFailoverHandler.failoverCalledWithInvalidTopology"));
      return ClusterAwareWriterFailoverHandler.DEFAULT_RESULT;
    }

    const reconnectToWriterHandlerTask = new ReconnectToWriterHandlerTask(
      currentTopology,
      getWriter(currentTopology),
      this.pluginService,
      this.initialConnectionProps,
      this.reconnectionWriterIntervalMs,
      Date.now() + this.maxFailoverTimeoutMs
    );

    const waitForNewWriterHandlerTask = new WaitForNewWriterHandlerTask(
      currentTopology,
      getWriter(currentTopology),
      this.readerFailoverHandler,
      this.pluginService,
      this.initialConnectionProps,
      this.readTopologyIntervalMs,
      Date.now() + this.maxFailoverTimeoutMs
    );

    let timeoutId: any;
    const timeoutTask: Promise<void> = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject("Connection attempt task timed out.");
      }, this.maxFailoverTimeoutMs);
    });

    const taskA = reconnectToWriterHandlerTask.call();
    const taskB = waitForNewWriterHandlerTask.call();

    let failed = false;
    let selectedTask = "";
    const singleTask: boolean = this.pluginService.getDialect().getFailoverRestrictions().includes(FailoverRestriction.DISABLE_TASK_A);
    const failoverTaskPromise = singleTask ? taskB : Promise.any([taskA, taskB]);

    const failoverTask = failoverTaskPromise
      .then((result) => {
        selectedTask = result.taskName;
        // If the first resolved promise is connected or has an error, return it.
        if (result.isConnected || result.error || singleTask) {
          return result;
        }

        // Return the other task result.
        if (selectedTask === ClusterAwareWriterFailoverHandler.RECONNECT_WRITER_TASK) {
          selectedTask = ClusterAwareWriterFailoverHandler.WAIT_NEW_WRITER_TASK;
          return taskB;
        } else if (selectedTask === ClusterAwareWriterFailoverHandler.WAIT_NEW_WRITER_TASK) {
          selectedTask = ClusterAwareWriterFailoverHandler.RECONNECT_WRITER_TASK;
          return taskA;
        }
        return ClusterAwareWriterFailoverHandler.DEFAULT_RESULT;
      })
      .catch((error) => {
        return new WriterFailoverResult(false, false, [], "None", null, error);
      });

    return await Promise.race([timeoutTask, failoverTask])
      .then((result) => {
        if (result && result.isConnected) {
          this.logTaskSuccess(result);
          return result;
        }
        failed = true;
        throw new AwsWrapperError("Connection attempt task timed out.");
      })
      .catch((error: any) => {
        logger.info(Messages.get("ClusterAwareWriterFailoverHandler.failedToConnectToWriterInstance"));
        failed = true;
        if (JSON.stringify(error).includes("Connection attempt task timed out.")) {
          return new WriterFailoverResult(false, false, [], "None", null);
        }
        throw error;
      })
      .finally(async () => {
        await reconnectToWriterHandlerTask.cancel(failed, selectedTask);
        await waitForNewWriterHandlerTask.cancel(selectedTask);
        clearTimeout(timeoutId);
      });
  }

  logTaskSuccess(result: WriterFailoverResult) {
    const topology = result.topology;
    if (!topology || topology.length === 0) {
      logger.error(Messages.get("ClusterAwareWriterFailoverHandler.successfulConnectionInvalidTopology", result.taskName ?? "None"));
      return;
    }

    const writerHost = getWriter(topology);
    const newWriterHost = writerHost === null ? "" : writerHost.url;
    logger.info(
      Messages.get(
        result.isNewHost
          ? "ClusterAwareWriterFailoverHandler.successfullyConnectedToNewWriterInstance"
          : "ClusterAwareWriterFailoverHandler.successfullyReconnectedToWriterInstance",
        result.client.id,
        newWriterHost
      )
    );
    return;
  }
}

class ReconnectToWriterHandlerTask {
  pluginService: PluginService;
  currentTopology: HostInfo[];
  originalWriterHost: HostInfo | null;
  initialConnectionProps: Map<string, any>;
  reconnectionWriterIntervalMs: number;
  currentClient: ClientWrapper | null = null;
  endTime: number;
  failoverCompleted: boolean = false;
  failoverCompletedDueToError: boolean = false;
  timeoutId: any = -1;

  constructor(
    currentTopology: HostInfo[],
    currentHost: HostInfo | null,
    pluginService: PluginService,
    initialConnectionProps: Map<string, any>,
    reconnectionWriterIntervalMs: number,
    endTime: number
  ) {
    this.currentTopology = currentTopology;
    this.originalWriterHost = currentHost;
    this.pluginService = pluginService;
    this.initialConnectionProps = initialConnectionProps;
    this.reconnectionWriterIntervalMs = reconnectionWriterIntervalMs;
    this.endTime = endTime;
  }

  async call(): Promise<WriterFailoverResult> {
    let success = false;

    let latestTopology: HostInfo[] = [];

    if (!this.originalWriterHost) {
      return new WriterFailoverResult(
        success,
        false,
        latestTopology,
        ClusterAwareWriterFailoverHandler.RECONNECT_WRITER_TASK,
        success ? this.currentClient : null
      );
    }

    logger.info(
      Messages.get(
        "ClusterAwareWriterFailoverHandler.taskAAttemptReconnectToWriterInstance",
        this.originalWriterHost.url,
        JSON.stringify(Object.fromEntries(maskProperties(this.initialConnectionProps)))
      )
    );

    try {
      while (latestTopology.length === 0 && Date.now() < this.endTime && !this.failoverCompleted) {
        await this.pluginService.abortTargetClient(this.currentClient);

        try {
          const props = new Map(this.initialConnectionProps);
          props.set(WrapperProperties.HOST.name, this.originalWriterHost.host);
          this.currentClient = await this.pluginService.forceConnect(this.originalWriterHost, props);
          await this.pluginService.forceRefreshHostList(this.currentClient);
          latestTopology = this.pluginService.getAllHosts();
        } catch (error) {
          // Propagate errors that are not caused by network errors.
          if (error instanceof AwsWrapperError && !this.pluginService.isNetworkError(error)) {
            logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskAEncounteredError", error.message));
            return new WriterFailoverResult(false, false, [], ClusterAwareWriterFailoverHandler.RECONNECT_WRITER_TASK, null, error);
          }
        }

        if (!latestTopology || latestTopology.length === 0) {
          await new Promise((resolve) => {
            this.timeoutId = setTimeout(resolve, this.reconnectionWriterIntervalMs);
          });
        }
      }
      success = isCurrentHostWriter(latestTopology, this.originalWriterHost);

      this.pluginService.setAvailability(this.originalWriterHost.allAliases, HostAvailability.AVAILABLE);
      return new WriterFailoverResult(
        success,
        false,
        latestTopology,
        ClusterAwareWriterFailoverHandler.RECONNECT_WRITER_TASK,
        success ? this.currentClient : null
      );
    } catch (error: any) {
      logger.error(error.message);
      return new WriterFailoverResult(false, false, [], ClusterAwareWriterFailoverHandler.RECONNECT_WRITER_TASK, null);
    } finally {
      if (this.currentClient && (this.failoverCompletedDueToError || !success)) {
        await this.pluginService.abortTargetClient(this.currentClient);
      }
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskAFinished"));
    }
  }

  async cancel(failed: boolean, selectedTask?: string) {
    clearTimeout(this.timeoutId);
    this.failoverCompleted = true;
    this.failoverCompletedDueToError = failed;

    // Task B was returned.
    if (selectedTask && selectedTask === ClusterAwareWriterFailoverHandler.WAIT_NEW_WRITER_TASK) {
      await this.pluginService.abortTargetClient(this.currentClient);
    }
  }
}

class WaitForNewWriterHandlerTask {
  readerFailoverHandler: ClusterAwareReaderFailoverHandler;
  pluginService: PluginService;
  currentTopology: HostInfo[];
  originalWriterHost: HostInfo | null;
  initialConnectionProps: Map<string, any>;
  readTopologyIntervalMs: number;
  currentClient: ClientWrapper | null = null;
  currentReaderHost: HostInfo | null = null;
  currentReaderTargetClient: ClientWrapper | null = null;
  endTime: number;
  connectToReaderTimeoutId: any = -1;
  refreshTopologyTimeoutId: any = -1;
  failoverCompleted: boolean = false;

  constructor(
    currentTopology: HostInfo[],
    currentHost: HostInfo | null,
    readerFailoverHandler: ClusterAwareReaderFailoverHandler,
    pluginService: PluginService,
    initialConnectionProps: Map<string, any>,
    readTopologyIntervalMs: number,
    endTime: number
  ) {
    this.currentTopology = currentTopology;
    this.originalWriterHost = currentHost;
    this.readerFailoverHandler = readerFailoverHandler;
    this.pluginService = pluginService;
    this.initialConnectionProps = initialConnectionProps;
    this.readTopologyIntervalMs = readTopologyIntervalMs;
    this.endTime = endTime;
  }

  async call() {
    logger.info(
      Messages.get(
        "ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriterInstance",
        JSON.stringify(Object.fromEntries(maskProperties(this.initialConnectionProps)))
      )
    );

    try {
      let success = false;
      while (!success && Date.now() < this.endTime && !this.failoverCompleted) {
        await this.connectToReader();
        success = await this.refreshTopologyAndConnectToNewWriter();
        if (!success) {
          await this.closeReaderClient();
        }
      }

      if (!success) {
        return new WriterFailoverResult(false, false, [], ClusterAwareWriterFailoverHandler.WAIT_NEW_WRITER_TASK, null);
      }

      return new WriterFailoverResult(true, true, this.currentTopology, ClusterAwareWriterFailoverHandler.WAIT_NEW_WRITER_TASK, this.currentClient);
    } catch (error: any) {
      logger.error(Messages.get("ClusterAwareWriterFailoverHandler.taskBEncounteredError", error.message));
      throw error;
    } finally {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBFinished"));
      await this.performFinalCleanup();
    }
  }

  isValidReaderConnection(result: ReaderFailoverResult): boolean {
    return result.isConnected && result.client != null && result.newHost != null;
  }

  async connectToReader() {
    while (Date.now() < this.endTime && !this.failoverCompleted) {
      try {
        const result = await this.readerFailoverHandler.getReaderConnection(this.currentTopology);
        if (this.isValidReaderConnection(result)) {
          this.currentReaderTargetClient = result.client;
          this.currentReaderHost = result.newHost;
          logger.info(
            Messages.get("ClusterAwareWriterFailoverHandler.taskBConnectedToReader", this.currentReaderHost == null ? "" : this.currentReaderHost.url)
          );
          break;
        }
      } catch (error) {
        // ignore
      }
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBFailedToConnectToAnyReader"));
      await new Promise((resolve) => {
        this.connectToReaderTimeoutId = setTimeout(resolve, 1000);
      });
    }
  }

  async refreshTopologyAndConnectToNewWriter(): Promise<boolean> {
    const allowOldWriter: boolean = this.pluginService.getDialect().getFailoverRestrictions().includes(FailoverRestriction.ENABLE_WRITER_IN_TASK_B);

    while (this.pluginService.getCurrentClient() && Date.now() < this.endTime && !this.failoverCompleted) {
      try {
        if (this.currentReaderTargetClient) {
          await this.pluginService.forceRefreshHostList(this.currentReaderTargetClient);
        }
        const topology = this.pluginService.getAllHosts();

        if (topology && topology.length > 0) {
          if (topology.length === 1) {
            // The currently connected reader is in a middle of failover. It's not yet connected
            // to a new writer and works in as "standalone" host. The handler needs to
            // wait till the reader gets connected to entire cluster and fetch a proper
            // cluster topology.

            // do nothing
            logger.info(
              Messages.get("ClusterAwareWriterFailoverHandler.standaloneHost", this.currentReaderHost == null ? "" : this.currentReaderHost.url)
            );
          } else {
            this.currentTopology = topology;
            const writerCandidate = getWriter(this.currentTopology);
            if (writerCandidate && (allowOldWriter || !this.isSame(writerCandidate, this.originalWriterHost))) {
              // new writer is available, and it's different from the previous writer
              logger.debug(logTopology(this.currentTopology, "[Task B] "));
              if (await this.connectToWriter(writerCandidate)) {
                return true;
              }
            }
          }
        }
      } catch (error: any) {
        logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBEncounteredError", error.message));
        return false;
      }

      await new Promise((resolve) => {
        this.connectToReaderTimeoutId = setTimeout(resolve, this.readTopologyIntervalMs);
      });
    }
    return false;
  }

  async connectToWriter(writerCandidate: HostInfo): Promise<boolean> {
    if (this.isSame(writerCandidate, this.currentReaderHost)) {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.alreadyWriter"));
      this.currentClient = this.currentReaderTargetClient;
      return true;
    } else {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriter", writerCandidate.url));
      // connect to the new writer
      const props = new Map(this.initialConnectionProps);
      props.set(WrapperProperties.HOST.name, writerCandidate.host);

      let targetClient = null;
      try {
        targetClient = await this.pluginService.forceConnect(writerCandidate, props);
        this.pluginService.setAvailability(writerCandidate.allAliases, HostAvailability.AVAILABLE);
        await this.callCloseClient(this.currentReaderTargetClient);
        await this.callCloseClient(this.currentClient);
        this.currentClient = targetClient;
        return true;
      } catch (error) {
        this.pluginService.setAvailability(writerCandidate.allAliases, HostAvailability.NOT_AVAILABLE);
        await this.pluginService.abortTargetClient(targetClient);
        return false;
      }
    }
  }

  isSame(hostInfo1: HostInfo | null, hostInfo2: HostInfo | null): boolean {
    if (!hostInfo1 || !hostInfo2) {
      return false;
    }

    return hostInfo1.host === hostInfo2.host;
  }

  async closeReaderClient() {
    try {
      await this.callCloseClient(this.currentReaderTargetClient);
    } finally {
      this.currentReaderTargetClient = null;
      this.currentReaderHost = null;
    }
  }

  async cancel(selectedTask?: string) {
    this.failoverCompleted = true;
    clearTimeout(this.connectToReaderTimeoutId);
    clearTimeout(this.refreshTopologyTimeoutId);

    // Task A was returned.
    if (selectedTask && selectedTask === ClusterAwareWriterFailoverHandler.RECONNECT_WRITER_TASK) {
      await this.callCloseClient(this.currentClient);
      await this.callCloseClient(this.currentReaderTargetClient);
    }
  }

  async performFinalCleanup(): Promise<void> {
    // Close the reader connection if it's not needed.
    if (this.currentReaderTargetClient && this.currentClient !== this.currentReaderTargetClient) {
      await this.pluginService.abortTargetClient(this.currentReaderTargetClient);
    }
  }

  async callCloseClient(targetClient: ClientWrapper | null) {
    await this.pluginService.abortTargetClient(targetClient);
  }
}
