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

import { ConnectionContext } from "./connection_context";
import { ContextPool } from "./context_pool";
import { HostInfo } from "../../../host_info";
import { PluginService } from "../../../plugin_service";
import { ClientWrapper } from "../../../client_wrapper";
import { WrapperProperties } from "../../../wrapper_property";
import { logger } from "../../../../logutils";
import { Messages } from "../../../utils/messages";
import { getCurrentTimeNano, sleep } from "../../../utils/utils";
import { TelemetryCounter } from "../../../utils/telemetry/telemetry_counter";
import { TelemetryFactory } from "../../../utils/telemetry/telemetry_factory";
import { TelemetryTraceLevel } from "../../../utils/telemetry/telemetry_trace_level";

export interface HostMonitor {
  startMonitoring(context: ConnectionContext): void;

  stopMonitoring(context: ConnectionContext): void;

  clearContexts(): void;

  isStopped(): boolean;

  run(): Promise<void>;

  releaseResources(): Promise<void>;
}

class ConnectionStatus {
  constructor(
    readonly isValid: boolean,
    readonly elapsedTimeNano: number
  ) {}
}

export class HostMonitorImpl implements HostMonitor {
  private static readonly SLEEP_WHEN_INACTIVE_MILLIS = 100;
  private static readonly MIN_CONNECTION_CHECK_TIMEOUT_MILLIS = 3000;

  private readonly pluginService: PluginService;
  private readonly telemetryFactory: TelemetryFactory;
  private readonly nodeInvalidCounter: TelemetryCounter;
  private readonly properties: Map<string, any>;
  private readonly hostInfo: HostInfo;
  private readonly monitorDisposalTimeMillis: number;
  private readonly contextPool: ContextPool;
  private readonly hostKey: string;

  private contextLastUsedTimestampNano: number;
  private started = false;
  private stopped = false;
  private cancelled = false;
  private monitoringClient: ClientWrapper | null = null;
  private delayTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private sleepTimeoutId: ReturnType<typeof setTimeout> | undefined;

  constructor(
    pluginService: PluginService,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    monitorDisposalTimeMillis: number,
    contextPool: ContextPool
  ) {
    this.pluginService = pluginService;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.monitorDisposalTimeMillis = monitorDisposalTimeMillis;
    this.contextPool = contextPool;
    this.hostKey = hostInfo.hostId || hostInfo.host;
    this.nodeInvalidCounter = this.telemetryFactory.createCounter(`efm.nodeUnhealthy.count.${this.hostKey}`);
    this.contextLastUsedTimestampNano = getCurrentTimeNano();
  }

  startMonitoring(context: ConnectionContext): void {
    if (this.stopped) {
      logger.warn(Messages.get("MonitorImpl.monitorIsStopped", this.hostInfo.host));
    }

    this.contextLastUsedTimestampNano = getCurrentTimeNano();
    this.contextPool.addContext(this.hostKey, context);

    if (!this.started) {
      this.started = true;
      this.run();
    }
  }

  stopMonitoring(context: ConnectionContext): void {
    if (context == null) {
      logger.warn(Messages.get("MonitorImpl.contextNullWarning"));
      return;
    }

    context.setInactive();
    this.contextLastUsedTimestampNano = getCurrentTimeNano();
  }

  clearContexts(): void {
    this.contextPool.clear(this.hostKey);
  }

  isStopped(): boolean {
    return this.stopped || this.cancelled;
  }

  async run(): Promise<void> {
    logger.debug(Messages.get("MonitorImpl.startMonitoring", this.hostInfo.host));

    try {
      while (!this.cancelled) {
        try {
          const currentTimeNano = getCurrentTimeNano();
          this.contextPool.promoteReadyContexts(this.hostKey, currentTimeNano);

          const activeContexts = this.contextPool.getActiveContexts(this.hostKey);

          if (activeContexts.length > 0) {
            this.contextLastUsedTimestampNano = getCurrentTimeNano();

            const statusCheckStartTimeNano = getCurrentTimeNano();
            const status = await this.checkConnectionStatus();

            let delayMillis = -1;

            for (const context of activeContexts) {
              if (!context.isActiveContext()) {
                continue;
              }

              await context.updateConnectionStatus(
                this.hostInfo.url,
                statusCheckStartTimeNano,
                statusCheckStartTimeNano + status.elapsedTimeNano,
                status.isValid
              );

              if (context.isActiveContext() && !context.isHostUnhealthy()) {
                if (delayMillis === -1 || delayMillis > context.failureDetectionIntervalMillis) {
                  delayMillis = context.failureDetectionIntervalMillis;
                }
              }
            }

            this.contextPool.removeInactiveContexts(this.hostKey);

            if (delayMillis === -1) {
              delayMillis = HostMonitorImpl.SLEEP_WHEN_INACTIVE_MILLIS;
            } else {
              delayMillis -= Math.round(status.elapsedTimeNano / 1_000_000);
              if (delayMillis <= 0) {
                delayMillis = HostMonitorImpl.MIN_CONNECTION_CHECK_TIMEOUT_MILLIS;
              }
            }

            await new Promise<void>((resolve) => {
              this.delayTimeoutId = setTimeout(resolve, delayMillis);
            });
          } else {
            if (getCurrentTimeNano() - this.contextLastUsedTimestampNano >= this.monitorDisposalTimeMillis * 1_000_000) {
              break;
            }
            await new Promise<void>((resolve) => {
              this.sleepTimeoutId = setTimeout(resolve, HostMonitorImpl.SLEEP_WHEN_INACTIVE_MILLIS);
            });
          }
        } catch (error: any) {
          logger.debug(Messages.get("MonitorImpl.errorDuringMonitoringContinue", error.message));
        }
      }
    } catch (error: any) {
      logger.debug(Messages.get("MonitorImpl.errorDuringMonitoringStop", error.message));
    } finally {
      this.stopped = true;
      await this.closeMonitoringClient();
    }

    logger.debug(Messages.get("MonitorImpl.stopMonitoring", this.hostInfo.host));
  }

  /**
   * Check the status of the monitored server by sending a ping.
   */
  private async checkConnectionStatus(): Promise<ConnectionStatus> {
    const connectContext = this.telemetryFactory.openTelemetryContext("Connection status check", TelemetryTraceLevel.FORCE_TOP_LEVEL);
    connectContext.setAttribute("url", this.hostInfo.host);
    return await connectContext.start(async () => {
      const startNanos = getCurrentTimeNano();
      try {
        if (this.monitoringClient != null && (await this.pluginService.isClientValid(this.monitoringClient))) {
          return new ConnectionStatus(true, getCurrentTimeNano() - startNanos);
        }

        await this.closeMonitoringClient();

        const monitoringConnProperties = new Map(this.properties);
        for (const key of monitoringConnProperties.keys()) {
          if (!key.startsWith(WrapperProperties.MONITORING_PROPERTY_PREFIX)) {
            continue;
          }
          monitoringConnProperties.set(key.substring(WrapperProperties.MONITORING_PROPERTY_PREFIX.length), this.properties.get(key));
          monitoringConnProperties.delete(key);
        }

        this.monitoringClient = await this.pluginService.forceConnect(this.hostInfo, monitoringConnProperties);
        return new ConnectionStatus(true, getCurrentTimeNano() - startNanos);
      } catch (error: any) {
        this.nodeInvalidCounter.inc();
        await this.closeMonitoringClient();
        return new ConnectionStatus(false, getCurrentTimeNano() - startNanos);
      }
    });
  }

  private async closeMonitoringClient(): Promise<void> {
    if (this.monitoringClient) {
      try {
        await this.pluginService.abortTargetClient(this.monitoringClient);
      } catch {
        // ignore
      }
      this.monitoringClient = null;
    }
  }

  async releaseResources(): Promise<void> {
    this.cancelled = true;
    clearTimeout(this.delayTimeoutId);
    clearTimeout(this.sleepTimeoutId);
    this.contextPool.clear(this.hostKey);
    await this.closeMonitoringClient();
    await sleep(500);
  }
}
