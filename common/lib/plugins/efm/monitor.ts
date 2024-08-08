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

import { MonitorConnectionContext } from "./monitor_connection_context";
import { HostInfo } from "../../host_info";
import { PluginService } from "../../plugin_service";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";

export interface Monitor {
  startMonitoring(context: MonitorConnectionContext): void;

  stopMonitoring(context: MonitorConnectionContext): void;

  clearContexts(): void;

  isStopped(): boolean;

  run(): Promise<void>;

  releaseResources(): Promise<void>;

  endMonitoringClient(): Promise<void>;
}

export class ConnectionStatus {
  isValid: boolean;
  elapsedTimeNano: number;

  constructor(isValid: boolean, elapsedTimeNano: number) {
    this.isValid = isValid;
    this.elapsedTimeNano = elapsedTimeNano;
  }
}

export class MonitorImpl implements Monitor {
  private readonly SLEEP_WHEN_INACTIVE_MILLIS: number = 100;
  private readonly MIN_CONNECTION_CHECK_TIMEOUT_MILLIS: number = 3000;
  private readonly MONITORING_PROPERTY_PREFIX: string = "monitoring_";

  private readonly activeContexts: MonitorConnectionContext[] = [];
  private readonly newContexts: MonitorConnectionContext[] = [];

  private readonly pluginService: PluginService;
  private readonly properties: Map<string, any>;
  private readonly hostInfo: HostInfo;
  private readonly monitorDisposalTimeMillis: number;
  private contextLastUsedTimestampNanos: number;
  private started = false;
  private stopped: boolean = false;
  private cancel: boolean = false;
  private monitoringClient: any | null = null;
  private delayMillisTimeoutId: any;
  private sleepWhenInactiveTimeoutId: any;

  constructor(pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, monitorDisposalTimeMillis: number) {
    this.pluginService = pluginService;
    this.properties = properties;
    this.hostInfo = hostInfo;
    this.monitorDisposalTimeMillis = monitorDisposalTimeMillis;

    this.contextLastUsedTimestampNanos = this.getCurrentTimeNano();
  }

  startRun() {
    this.run();
    this.started = true;
  }

  startMonitoring(context: MonitorConnectionContext): void {
    if (this.stopped) {
      logger.debug(Messages.get("MonitorImpl.monitorIsStopped", this.hostInfo.host));
    }

    const currentTimeNanos: number = this.getCurrentTimeNano();
    context.startMonitorTimeNano = currentTimeNanos;
    this.contextLastUsedTimestampNanos = currentTimeNanos;
    this.newContexts.push(context);
    if (!this.started) {
      this.startRun();
    }
  }

  stopMonitoring(context: MonitorConnectionContext): void {
    if (context == null) {
      logger.warning(Messages.get("MonitorImpl.contextNullWarning"));
      return;
    }

    context.isActiveContext = false;
    this.contextLastUsedTimestampNanos = this.getCurrentTimeNano();
  }

  async run(): Promise<void> {
    logger.debug(Messages.get("MonitorImpl.startMonitoring", this.hostInfo.host));

    try {
      this.stopped = false;
      while (!this.cancel) {
        try {
          let newMonitorContext: MonitorConnectionContext | undefined;
          let firstAddedNewMonitorContext: MonitorConnectionContext | null = null;
          const currentTimeNano: number = this.getCurrentTimeNano();

          while ((newMonitorContext = this.newContexts.shift()) != null) {
            if (firstAddedNewMonitorContext === newMonitorContext) {
              this.newContexts.push(newMonitorContext);
              break;
            }

            if (newMonitorContext.isActiveContext) {
              if (newMonitorContext.expectedActiveMonitoringStartTimeNano > currentTimeNano) {
                this.newContexts.push(newMonitorContext);
                firstAddedNewMonitorContext = firstAddedNewMonitorContext ?? newMonitorContext;
              } else {
                this.activeContexts.push(newMonitorContext);
              }
            }
          }

          if (this.activeContexts.length > 0) {
            this.contextLastUsedTimestampNanos = this.getCurrentTimeNano();

            const statusCheckStartTimeNanos: number = this.getCurrentTimeNano();
            this.contextLastUsedTimestampNanos = statusCheckStartTimeNanos;

            const status: ConnectionStatus = await this.checkConnectionStatus();
            let delayMillis: number = -1;

            let monitorContext: MonitorConnectionContext | undefined;
            let firstAddedMonitorContext: MonitorConnectionContext | null = null;

            while ((monitorContext = this.activeContexts.shift()) != null) {
              // If context is already invalid, just skip it.
              if (!monitorContext.isActiveContext) {
                continue;
              }

              if (firstAddedMonitorContext == monitorContext) {
                // This context is already processed by this loop.
                // Add it to the array and exit this loop.
                this.activeContexts.push(monitorContext);
                break;
              }

              // Otherwise, process this context.
              await monitorContext.updateConnectionStatus(
                this.hostInfo.url,
                statusCheckStartTimeNanos,
                statusCheckStartTimeNanos + status.elapsedTimeNano,
                status.isValid
              );

              if (monitorContext.isActiveContext && !monitorContext.isHostUnhealthy) {
                this.activeContexts.push(monitorContext);
                if (firstAddedMonitorContext == null) {
                  firstAddedMonitorContext = monitorContext;
                }

                if (delayMillis == -1 || delayMillis > monitorContext.failureDetectionIntervalMillis) {
                  delayMillis = monitorContext.failureDetectionIntervalMillis;
                }
              }
            }

            if (delayMillis == -1) {
              // No active contexts.
              delayMillis = this.SLEEP_WHEN_INACTIVE_MILLIS;
            } else {
              delayMillis -= Math.round(status.elapsedTimeNano / 1_000_000);
              // Check for minimum delay between host health check;
              if (delayMillis <= 0) {
                delayMillis = this.MIN_CONNECTION_CHECK_TIMEOUT_MILLIS;
              }
            }

            await new Promise((resolve) => {
              this.delayMillisTimeoutId = setTimeout(resolve, delayMillis);
            });
          } else {
            if (this.getCurrentTimeNano() - this.contextLastUsedTimestampNanos >= this.monitorDisposalTimeMillis * 1_000_000) {
              break;
            }
            await new Promise((resolve) => {
              this.sleepWhenInactiveTimeoutId = setTimeout(resolve, this.SLEEP_WHEN_INACTIVE_MILLIS);
            });
          }
        } catch (error: any) {
          logger.debug(Messages.get("MonitorImpl.exceptionDuringMonitoringContinue", error.message));
        }
      }
    } catch (error: any) {
      logger.debug(Messages.get("MonitorImpl.exceptionDuringMonitoringStop", error.message));
    } finally {
      this.stopped = true;
      await this.endMonitoringClient();
    }

    logger.debug(Messages.get("MonitorImpl.stopMonitoring", this.hostInfo.host));
  }

  /**
   * Check the status of the monitored server by sending a ping.
   *
   * @return whether the server is still alive and the elapsed time spent checking.
   */
  async checkConnectionStatus(): Promise<ConnectionStatus> {
    const startNanos = this.getCurrentTimeNano();
    try {
      const clientIsValid = this.monitoringClient == null ? false : await this.pluginService.isClientValid(this.monitoringClient);

      if (this.monitoringClient != null && clientIsValid) {
        return Promise.resolve(new ConnectionStatus(clientIsValid, this.getCurrentTimeNano() - startNanos));
      }

      await this.endMonitoringClient();

      // Open a new connection.
      const monitoringConnProperties: Map<string, any> = new Map(this.properties);

      for (const key of this.properties.keys()) {
        if (!key.startsWith(this.MONITORING_PROPERTY_PREFIX)) {
          continue;
        }

        monitoringConnProperties.set(key.substring(this.MONITORING_PROPERTY_PREFIX.length), this.properties.get(key));
        monitoringConnProperties.delete(key);
      }

      logger.debug(`Opening a monitoring connection to ${this.hostInfo.url}`);
      this.monitoringClient = await this.pluginService.forceConnect(this.hostInfo, monitoringConnProperties);
      logger.debug(`Successfully opened monitoring connection to ${this.hostInfo.url}`);
      return Promise.resolve(new ConnectionStatus(true, this.getCurrentTimeNano() - startNanos));
    } catch (error: any) {
      await this.endMonitoringClient();
      return Promise.resolve(new ConnectionStatus(false, this.getCurrentTimeNano() - startNanos));
    }
  }

  clearContexts(): void {
    this.activeContexts.length = 0;
    this.newContexts.length = 0;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  protected getCurrentTimeNano() {
    return Number(process.hrtime.bigint());
  }

  async releaseResources() {
    this.cancel = true;
    clearTimeout(this.delayMillisTimeoutId);
    clearTimeout(this.sleepWhenInactiveTimeoutId);
    await this.endMonitoringClient();
  }

  async endMonitoringClient() {
    if (this.monitoringClient) {
      await this.pluginService.tryClosingTargetClient(this.monitoringClient);
      this.monitoringClient = null;
    }
  }
}
