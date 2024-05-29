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
import { maskProperties, sleep } from "../../utils/utils";
import { ReaderFailoverResult } from "./reader_failover_result";
import { HostRole } from "../../host_role";
import { Messages } from "../../utils/messages";
import { logger } from "../../../logutils";
import { WrapperProperties } from "../../wrapper_property";

export interface WriterFailoverHandler {
  failover(currentTopology: HostInfo[]): Promise<WriterFailoverResult>;
}

function getWriter(topology: HostInfo[]): HostInfo | null {
  if (!topology || topology.length === 0) {
    return null;
  }

  for (let i = 0; i < topology.length; i++) {
    if (topology[i].role === HostRole.WRITER) {
      return topology[i];
    }
  }
  return null;
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
  private readonly pluginService: PluginService;
  private readonly readerFailoverHandler: ClusterAwareReaderFailoverHandler;
  private readonly initialConnectionProps: Map<string, any>;
  maxFailoverTimeoutMs = 60000; // 60 sec
  readTopologyIntervalMs = 5000; // 5 sec
  reconnectionWriterIntervalMs = 5000; // 5 sec
  test = false;

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
      return Promise.resolve(ClusterAwareWriterFailoverHandler.DEFAULT_RESULT);
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
    const timeoutTask = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject("Connection attempt task timed out.");
      }, this.maxFailoverTimeoutMs);
    });

    const taskA = reconnectToWriterHandlerTask.call();
    const taskB = waitForNewWriterHandlerTask.call();

    const failoverTask = Promise.any([taskA, taskB])
      .then((result) => {
        this.test = true;
        if (result.isConnected || result.exception) {
          return result;
        }

        if (reconnectToWriterHandlerTask.taskComplete) {
          return taskB;
        } else if (waitForNewWriterHandlerTask.taskComplete) {
          return taskA;
        }
        return ClusterAwareWriterFailoverHandler.DEFAULT_RESULT;
      })
      .catch((error) => {
        return new WriterFailoverResult(false, false, [], "None", null, error);
      });

    try {
      const result = await Promise.race([timeoutTask, failoverTask]);
      if (result instanceof WriterFailoverResult) {
        if (result.isConnected) {
          this.logTaskSuccess(result);
        }
        return result;
      }
      throw new AwsWrapperError("Resolved result was not a WriterFailoverResult.");
    } catch (error) {
      logger.info("ClusterAwareWriterFailoverHandler.failedToConnectToWriterInstance");
      if (JSON.stringify(error).includes("Connection attempt task timed out.")) {
        return new WriterFailoverResult(false, false, [], "None", null);
      }
      throw error;
    } finally {
      await reconnectToWriterHandlerTask.cancel();
      await waitForNewWriterHandlerTask.cancel();
      clearTimeout(timeoutId);
    }
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
  currentClient?: any;
  endTime: number;
  failoverCompleted: boolean = false;
  timeoutId: any = -1;
  taskComplete: boolean = false;

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
      return new WriterFailoverResult(success, false, latestTopology, "TaskA", success ? this.currentClient : null);
    }

    logger.info(
      Messages.get(
        "ClusterAwareWriterFailoverHandler.taskAAttemptReconnectToWriterInstance",
        this.originalWriterHost.url,
        JSON.stringify(maskProperties(this.initialConnectionProps))
      )
    );

    try {
      while (latestTopology.length === 0 && Date.now() < this.endTime && !this.failoverCompleted) {
        if (this.currentClient) {
          await this.pluginService.tryClosingTargetClient(this.currentClient);
        }

        try {
          const props = new Map(this.initialConnectionProps);
          props.set(WrapperProperties.HOST.name, this.originalWriterHost.host);
          this.currentClient =  await this.pluginService.forceConnect(this.originalWriterHost, props);
          await this.pluginService.forceRefreshHostList(this.currentClient);
          latestTopology = this.pluginService.getHosts();
        } catch (error) {
          // Propagate exceptions that are not caused by network errors.
          if (error instanceof AwsWrapperError && !this.pluginService.isNetworkError(error)) {
            logger.info("ClusterAwareWriterFailoverHandler.taskAEncounteredException", JSON.stringify(error));
            return new WriterFailoverResult(false, false, [], "TaskA", null, error);
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
      return new WriterFailoverResult(success, false, latestTopology, "TaskA", success ? this.currentClient : null);
    } catch (error) {
      logger.error(error);
      return new WriterFailoverResult(false, false, [], "TaskA", null);
    } finally {
      if (this.currentClient && !success) {
        await this.pluginService.tryClosingTargetClient(this.currentClient);
      }
      this.taskComplete = true;
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskAFinished"));
    }
  }

  async cancel() {
    clearTimeout(this.timeoutId);
    this.failoverCompleted = true;
    if (!this.taskComplete) {
      await this.pluginService.tryClosingTargetClient(this.currentClient);
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
  currentClient: any = null;
  currentReaderHost: HostInfo | null = null;
  currentReaderTargetClient: any = null;
  endTime: number;
  connectToReaderTimeoutId: any = -1;
  refreshTopologyTimeoutId: any = -1;
  failoverCompleted: boolean = false;
  taskComplete: boolean = false;

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
      Messages.get("ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriterInstance", JSON.stringify(this.initialConnectionProps))
    );
    if (!this.originalWriterHost) {
      return new WriterFailoverResult(false, false, [], "TaskB", null);
    }

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
        return new WriterFailoverResult(false, false, [], "TaskB", null);
      }

      return new WriterFailoverResult(true, true, this.currentTopology, "TaskB", this.currentClient);
    } catch (error) {
      logger.error(Messages.get("ClusterAwareWriterFailoverHandler.taskBEncounteredException", JSON.stringify(error)));
      throw error;
    } finally {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBFinished"));
      this.taskComplete = true;
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
    while (this.pluginService.getCurrentClient() && Date.now() < this.endTime && !this.failoverCompleted) {
      try {
        if (this.currentReaderTargetClient) {
          await this.pluginService.forceRefreshHostList(this.currentReaderTargetClient);
        }
        const topology = this.pluginService.getHosts();

        if (topology && topology.length > 0) {
          if (topology.length === 1) {
            // The currently connected reader is in a middle of failover. It's not yet connected
            // to a new writer and works in as "standalone" node. The handler needs to
            // wait till the reader gets connected to entire cluster and fetch a proper
            // cluster topology.

            // do nothing
            logger.info(
              Messages.get("ClusterAwareWriterFailoverHandler.standaloneNode", this.currentReaderHost == null ? "" : this.currentReaderHost.url)
            );
          } else {
            this.currentTopology = topology;
            const writerCandidate = getWriter(this.currentTopology);

            if (writerCandidate && !this.isSame(writerCandidate, this.originalWriterHost)) {
              // new writer is available, and it's different from the previous writer
              if (await this.connectToWriter(writerCandidate)) {
                return Promise.resolve(true);
              }
            }
          }
        }
      } catch (error) {
        logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBEncounteredException", JSON.stringify(error)));
        return Promise.resolve(false);
      }

      await new Promise((resolve) => {
        this.connectToReaderTimeoutId = setTimeout(resolve, this.readTopologyIntervalMs);
      });
    }
    return Promise.resolve(false);
  }

  async connectToWriter(writerCandidate: HostInfo): Promise<boolean> {
    if (this.isSame(writerCandidate, this.currentReaderHost)) {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.alreadyWriter"));
      this.currentClient = this.currentReaderTargetClient;
      return Promise.resolve(true);
    } else {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriter", writerCandidate.url));
      // connect to the new writer
      const props = new Map(this.initialConnectionProps);
      props.set(WrapperProperties.HOST.name, writerCandidate.host);
      
      let targetClient;
      try {
        this.pluginService.setAvailability(writerCandidate.allAliases, HostAvailability.AVAILABLE);
        targetClient = await this.pluginService.forceConnect(writerCandidate, props);
        await this.pluginService.tryClosingTargetClient(this.currentReaderTargetClient);
        await this.pluginService.tryClosingTargetClient(this.currentClient);
        this.currentClient = targetClient;
        return Promise.resolve(true);
      } catch (error) {
        this.pluginService.setAvailability(writerCandidate.allAliases, HostAvailability.NOT_AVAILABLE);
        await this.pluginService.tryClosingTargetClient(targetClient);
        return Promise.resolve(false);
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
      await this.pluginService.tryClosingTargetClient(this.currentReaderTargetClient);
    } catch (error) {
      // ignore
    } finally {
      this.currentReaderTargetClient = null;
      this.currentReaderHost = null;
    }
  }

  async cancel() {
    this.failoverCompleted = true;
    clearTimeout(this.connectToReaderTimeoutId);
    clearTimeout(this.refreshTopologyTimeoutId);
    await this.performFinalCleanup();
  }

  async performFinalCleanup(): Promise<void> {
    // Close the reader connection if it's not needed
    if (this.currentReaderTargetClient && this.currentClient !== this.currentReaderTargetClient) {
      await this.pluginService.tryClosingTargetClient(this.currentReaderTargetClient);
    }
    if (!this.taskComplete) {
      await this.pluginService.tryClosingTargetClient(this.currentClient);
    }
  }
}
