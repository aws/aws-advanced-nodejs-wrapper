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
import { AwsClient } from "../../aws_client";
import { PluginService } from "../../plugin_service";
import { HostAvailability } from "../../host_availability/host_availability";
import { AwsWrapperError } from "../../utils/errors";
import { maskProperties, sleep } from "../../utils/utils";
import { ReaderFailoverResult } from "./reader_failover_result";
import { HostRole } from "../../host_role";
import { Messages } from "../../utils/messages";
import { logger } from "../../../logutils";

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

export class ClusterAwareWriterFailoverHandler implements WriterFailoverHandler {
  static readonly DEFAULT_RESULT = new WriterFailoverResult(false, false, [], null, "None");
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
      return Promise.resolve(ClusterAwareWriterFailoverHandler.DEFAULT_RESULT);
    }

    const waitForNewWriterHandlerTask = new WaitForNewWriterHandlerTask(
      currentTopology,
      getWriter(currentTopology),
      this.readerFailoverHandler,
      this.pluginService,
      this.initialConnectionProps,
      this.readTopologyIntervalMs,
      Date.now() + this.maxFailoverTimeoutMs
    );

    let timer: any;
    const timeoutTask = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject("Connection attempt task timed out.");
      }, this.maxFailoverTimeoutMs);
    });

    const failoverTask = this.reconnectToWriterHandler(getWriter(currentTopology), Date.now() + this.maxFailoverTimeoutMs)
      .then((result) => {
        if (result.isConnected || result.exception) {
          return result;
        }
        return waitForNewWriterHandlerTask.waitForNewWriterHandler();
      })
      .catch((error) => {
        return new WriterFailoverResult(false, false, [], null, "None", error);
      });

    return Promise.race([timeoutTask, failoverTask])
      .then((result) => {
        if (result instanceof WriterFailoverResult) {
          if (result.isConnected) {
            this.logTaskSuccess(result);
          }
          return result;
        } else {
          throw new AwsWrapperError("Resolved result was not a WriterFailoverResult.");
        }
      })
      .catch((error) => {
        logger.info("ClusterAwareWriterFailoverHandler.failedToConnectToWriterInstance");
        if (error === "Connection attempt task timed out.") {
          return new WriterFailoverResult(false, false, [], null, "None");
        } else {
          throw new AwsWrapperError(error);
        }
      })
      .finally(() => {
        clearTimeout(timer);
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
        newWriterHost
      )
    );
    return;
  }

  async reconnectToWriterHandler(originalWriterHost: HostInfo | null, endTime: number): Promise<WriterFailoverResult> {
    let success = false;
    let client = null;

    let latestTopology: HostInfo[] = [];

    if (!originalWriterHost) {
      return new WriterFailoverResult(success, false, latestTopology, success ? client : null, "TaskA");
    }

    logger.info(
      Messages.get(
        "ClusterAwareWriterFailoverHandler.taskAAttemptReconnectToWriterInstance",
        originalWriterHost.url,
        JSON.stringify(maskProperties(this.initialConnectionProps))
      )
    );

    try {
      while (latestTopology.length === 0) {
        if (Date.now() > endTime) {
          return new WriterFailoverResult(false, false, [], null, "TaskA");
        }

        if (client) {
          await client.end();
        }

        try {
          client = await this.pluginService.createTargetClientAndConnect(originalWriterHost, this.initialConnectionProps, true);
          await this.pluginService.forceRefreshHostList(client);
          latestTopology = this.pluginService.getHosts();
        } catch (error) {
          // Propagate exceptions that are not caused by network errors.
          if (error instanceof AwsWrapperError && !this.pluginService.isNetworkError(error)) {
            logger.info("ClusterAwareWriterFailoverHandler.taskAEncounteredException", JSON.stringify(error));
            return new WriterFailoverResult(false, false, [], null, "TaskA", error);
          }
        }

        if (!latestTopology || latestTopology.length === 0) {
          await sleep(this.reconnectionWriterIntervalMs);
        }
      }

      success = this.isCurrentHostWriter(latestTopology, originalWriterHost);
      this.pluginService.setAvailability(originalWriterHost.allAliases, HostAvailability.AVAILABLE);
      return new WriterFailoverResult(success, false, latestTopology, success ? client : null, "TaskA");
    } catch (error) {
      logger.error(error);
      return new WriterFailoverResult(false, false, [], null, "TaskA");
    } finally {
      if (client && !success) {
        await client.end();
      }
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskAFinished"));
    }
  }

  isCurrentHostWriter(topology: HostInfo[], originalWriterHost: HostInfo): boolean {
    const latestWriter = getWriter(topology);
    const latestWriterAllAliases = latestWriter?.allAliases;
    const currentAliases = originalWriterHost.allAliases;
    if (currentAliases && latestWriterAllAliases) {
      return [...currentAliases].filter((alias) => latestWriterAllAliases.has(alias)).length > 0;
    }
    return false;
  }
}

class WaitForNewWriterHandlerTask {
  readerFailoverHandler: ClusterAwareReaderFailoverHandler;
  pluginService: PluginService;
  currentTopology: HostInfo[];
  originalWriterHost: HostInfo | null;
  initialConnectionProps: Map<string, any>;
  readTopologyIntervalMs: number;
  currentClient: AwsClient | null = null;
  currentReaderHost: HostInfo | null = null;
  currentReaderClient: AwsClient | null = null;
  endTime: number;

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

  async waitForNewWriterHandler() {
    logger.info(
      Messages.get("ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriterInstance", JSON.stringify(this.initialConnectionProps))
    );
    if (!this.originalWriterHost) {
      return new WriterFailoverResult(false, false, [], null, "TaskB");
    }

    try {
      let success = false;
      while (!success && Date.now() < this.endTime) {
        await this.connectToReader();
        success = await this.refreshTopologyAndConnectToNewWriter();
        if (!success) {
          await this.closeReaderConnection();
        }
      }

      return new WriterFailoverResult(true, true, this.currentTopology, this.currentClient, "TaskB");
    } catch (error) {
      logger.error(Messages.get("ClusterAwareWriterFailoverHandler.taskBEncounteredException", JSON.stringify(error)));
      throw error;
    } finally {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBFinished"));
      this.performFinalCleanup();
    }
  }

  isValidReaderConnection(result: ReaderFailoverResult): boolean {
    return result.isConnected && result.client != null && result.newHost != null;
  }

  async connectToReader() {
    while (Date.now() < this.endTime) {
      try {
        const result = await this.readerFailoverHandler.getReaderConnection(this.currentTopology);
        if (this.isValidReaderConnection(result)) {
          this.currentReaderClient = result.client;
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
      await sleep(1000);
    }
  }

  async refreshTopologyAndConnectToNewWriter(): Promise<boolean> {
    while (this.currentReaderClient && Date.now() < this.endTime) {
      try {
        await this.pluginService.forceRefreshHostList(this.currentReaderClient);
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
              logger.info("TaskB " + JSON.stringify(this.currentTopology));
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

      await sleep(this.readTopologyIntervalMs);
    }
    return Promise.resolve(false);
  }

  async connectToWriter(writerCandidate: HostInfo): Promise<boolean> {
    if (this.isSame(writerCandidate, this.currentReaderHost)) {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.alreadyWriter"));
      this.currentClient = this.currentReaderClient;
      return Promise.resolve(true);
    } else {
      logger.info(Messages.get("ClusterAwareWriterFailoverHandler.taskBAttemptConnectionToNewWriter", writerCandidate.url));
      // connect to the new writer
      return await this.pluginService
        .createTargetClientAndConnect(writerCandidate, this.initialConnectionProps, true)
        .then((result) => {
          this.currentClient = result;
          this.pluginService.setAvailability(writerCandidate.allAliases, HostAvailability.AVAILABLE);
          return true;
        })
        .catch(() => {
          this.pluginService.setAvailability(writerCandidate.allAliases, HostAvailability.NOT_AVAILABLE);
          return false;
        });
    }
  }

  isSame(hostInfo1: HostInfo | null, hostInfo2: HostInfo | null): boolean {
    if (!hostInfo1 || !hostInfo2) {
      return false;
    }

    return hostInfo1.host === hostInfo2.host;
  }

  async closeReaderConnection() {
    try {
      if (this.currentReaderClient) {
        await this.currentReaderClient.end();
      }
    } catch (error) {
      // ignore
    } finally {
      this.currentReaderClient = null;
      this.currentReaderHost = null;
    }
  }

  async performFinalCleanup(): Promise<void> {
    // Close the reader connection if it's not needed
    if (this.currentReaderClient && this.currentClient !== this.currentReaderClient) {
      this.currentReaderClient.end().catch((error) => {
        // ignore
      });
    }
  }
}
