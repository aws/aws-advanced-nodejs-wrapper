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
import { HostInfo } from "../../../host_info";
import { PluginService } from "../../../plugin_service";
import { ClientWrapper } from "../../../client_wrapper";
import { WrapperProperties } from "../../../wrapper_property";
import { logger } from "../../../../logutils";
import { Messages } from "../../../utils/messages";
import { getCurrentTimeNano } from "../../../utils/utils";
import { getTimeInNanos } from "../../../utils/utils";
import { TelemetryCounter } from "../../../utils/telemetry/telemetry_counter";
import { TelemetryFactory } from "../../../utils/telemetry/telemetry_factory";
import { TelemetryTraceLevel } from "../../../utils/telemetry/telemetry_trace_level";
import { AbstractMonitor, MonitorState } from "../../../utils/monitoring/monitor";

export interface HostMonitor {
  startMonitoring(context: ConnectionContext): void;

  stopMonitoring(context: ConnectionContext): void;

  clearContexts(): void;

  isStopped(): boolean;

  run(): Promise<void>;

  releaseResources(): Promise<void>;
}

type ConnectionStatus = [isValid: boolean, elapsedTimeNano: number];

export class HostMonitorImpl extends AbstractMonitor implements HostMonitor {
  private static readonly SLEEP_WHEN_INACTIVE_MILLIS = 100;
  private static readonly MIN_CONNECTION_CHECK_TIMEOUT_MILLIS = 3000;
  private static readonly MONITOR_TERMINATION_TIMEOUT_SEC = 30;

  private readonly pluginService: PluginService;
  private readonly telemetryFactory: TelemetryFactory;
  private readonly hostInvalidCounter: TelemetryCounter;
  private readonly properties: Map<string, any>;
  private readonly hostInfo: HostInfo;
  private readonly monitorDisposalTimeMillis: number;
  private contexts: ConnectionContext[] = [];

  private contextLastUsedTimestampNano: number;
  private monitoringClient: ClientWrapper | null = null;
  private delayTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private sleepTimeoutId: ReturnType<typeof setTimeout> | undefined;

  constructor(pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, monitorDisposalTimeMillis: number) {
    super(HostMonitorImpl.MONITOR_TERMINATION_TIMEOUT_SEC);
    this.pluginService = pluginService;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.monitorDisposalTimeMillis = monitorDisposalTimeMillis;
    this.hostInvalidCounter = this.telemetryFactory.createCounter(`efm.nodeUnhealthy.count.${hostInfo.hostId || hostInfo.host}`);
    this.contextLastUsedTimestampNano = getCurrentTimeNano();
  }

  startMonitoring(context: ConnectionContext): void {
    if (this._stop) {
      logger.warn(Messages.get("MonitorImpl.monitorIsStopped", this.hostInfo.host));
    }

    this.contextLastUsedTimestampNano = getCurrentTimeNano();
    this.lastActivityTimestampNanos = getTimeInNanos();
    this.contexts.push(context);
  }

  stopMonitoring(context: ConnectionContext): void {
    if (!context) {
      logger.warn(Messages.get("MonitorImpl.contextNullWarning"));
      return;
    }

    context.setInactive();
    this.contextLastUsedTimestampNano = getCurrentTimeNano();
    this.lastActivityTimestampNanos = getTimeInNanos();
  }

  clearContexts(): void {
    this.contexts.length = 0;
  }

  isStopped(): boolean {
    return this._stop || this.state === MonitorState.STOPPED;
  }

  canDispose(): boolean {
    return this.contexts.length === 0;
  }

  async monitor(): Promise<void> {
    logger.debug(Messages.get("MonitorImpl.startMonitoring", this.hostInfo.host));

    try {
      while (!this._stop) {
        try {
          this.lastActivityTimestampNanos = getTimeInNanos();

          const activeContexts = this.contexts.filter((ctx) => ctx.isActiveContext());

          if (activeContexts.length > 0) {
            this.contextLastUsedTimestampNano = getCurrentTimeNano();

            const statusCheckStartTimeNano = getCurrentTimeNano();
            const [isValid, elapsedTimeNano] = await this.checkConnectionStatus();

            let delayMillis = -1;

            for (const context of activeContexts) {
              if (!context.isActiveContext()) {
                continue;
              }

              await context.updateConnectionStatus(this.hostInfo.url, statusCheckStartTimeNano, statusCheckStartTimeNano + elapsedTimeNano, isValid);

              if (
                context.isActiveContext() &&
                !context.isHostUnhealthy() &&
                statusCheckStartTimeNano >= context.expectedActiveMonitoringStartTimeNano
              ) {
                if (delayMillis === -1 || delayMillis > context.failureDetectionIntervalMillis) {
                  delayMillis = context.failureDetectionIntervalMillis;
                }
              }
            }

            this.contexts = this.contexts.filter((ctx) => ctx.isActiveContext() && !ctx.isHostUnhealthy());

            if (delayMillis === -1) {
              delayMillis = HostMonitorImpl.SLEEP_WHEN_INACTIVE_MILLIS;
            } else {
              delayMillis -= Math.round(elapsedTimeNano / 1_000_000);
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
    }

    logger.debug(Messages.get("MonitorImpl.stopMonitoring", this.hostInfo.host));
  }

  async close(): Promise<void> {
    this.contexts.length = 0;
    await this.closeMonitoringClient();
  }

  async releaseResources(): Promise<void> {
    clearTimeout(this.delayTimeoutId);
    clearTimeout(this.sleepTimeoutId);
    await this.stop();
  }

  protected async checkConnectionStatus(): Promise<ConnectionStatus> {
    const connectContext = this.telemetryFactory.openTelemetryContext("Connection status check", TelemetryTraceLevel.FORCE_TOP_LEVEL);
    connectContext.setAttribute("url", this.hostInfo.host);
    return await connectContext.start(async () => {
      const startNanos = getCurrentTimeNano();
      try {
        if (this.monitoringClient != null && (await this.pluginService.isClientValid(this.monitoringClient))) {
          return [true, getCurrentTimeNano() - startNanos];
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
        return [true, getCurrentTimeNano() - startNanos];
      } catch (error: any) {
        this.hostInvalidCounter.inc();
        await this.closeMonitoringClient();
        return [false, getCurrentTimeNano() - startNanos];
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
}
