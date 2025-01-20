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
import { ClientWrapper } from "../../client_wrapper";
import { sleep } from "../../utils/utils";
import { WrapperProperties } from "../../wrapper_property";
import { TelemetryFactory } from "../../utils/telemetry/telemetry_factory";
import { TelemetryCounter } from "../../utils/telemetry/telemetry_counter";
import { TelemetryTraceLevel } from "../../utils/telemetry/telemetry_trace_level";
import { HostAvailability } from "../../host_availability/host_availability";
import { MapUtils } from "../../utils/map_utils";
import { AwsWrapperError, InternalQueryTimeoutError } from "../../utils/errors";

export interface Monitor {
  startMonitoring(context: MonitorConnectionContext): void;

  run(): Promise<void>;

  canDispose(): boolean;

  endMonitoringClient(): Promise<void>;
}

export class MonitorImpl implements Monitor {
  private static readonly TASK_SLEEP_NANOS: number = 100 * 1000000;
  private activeContexts: WeakRef<MonitorConnectionContext>[] = [];
  static newContexts: Map<number, Array<WeakRef<MonitorConnectionContext>>> = new Map<number, Array<WeakRef<MonitorConnectionContext>>>();
  private readonly pluginService: PluginService;
  private readonly telemetryFactory: TelemetryFactory;
  private readonly properties: Map<string, any>;
  private readonly hostInfo: HostInfo;
  private stopped: boolean = false;

  private monitoringClient: ClientWrapper | null = null;

  private readonly failureDetectionTimeNano: number;
  private readonly failureDetectionIntervalNanos: number;
  private readonly failureDetectionCount: number;

  private invalidHostStartTimeNano: number;
  private failureCount: number;
  private hostUnhealthy: boolean = false;
  private readonly abortedConnectionsCounter: TelemetryCounter;

  constructor(
    pluginService: PluginService,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number,
    abortedConnectionsCounter: TelemetryCounter
  ) {
    this.pluginService = pluginService;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.failureDetectionTimeNano = failureDetectionTimeMillis * 1000000;
    this.failureDetectionIntervalNanos = failureDetectionIntervalMillis * 1000000;
    this.failureDetectionCount = failureDetectionCount;
    this.abortedConnectionsCounter = abortedConnectionsCounter;

    const hostId: string = this.hostInfo.hostId ?? this.hostInfo.host;

    this.telemetryFactory.createGauge(`efm2.newContexts.size.${hostId}`, () => MonitorImpl.newContexts.size == Number.MAX_SAFE_INTEGER);

    this.telemetryFactory.createGauge(`efm2.activeContexts.size.${hostId}`, () => this.activeContexts.length == Number.MAX_SAFE_INTEGER);

    this.telemetryFactory.createGauge(`efm2.hostHealthy.${hostId}`, () => (this.hostUnhealthy ? 0 : 1));
    const task1 = this.newContextRun();
    const task2 = this.run();
    Promise.all([task1, task2]).catch((error: any) => {
      if (error instanceof InternalQueryTimeoutError) {
        throw error;
      }
      throw new AwsWrapperError(error);
    });
  }

  canDispose(): boolean {
    return this.activeContexts.length === 0 && MonitorImpl.newContexts.size === 0;
  }

  async close(): Promise<void> {
    this.stopped = true;
    // Waiting for 30s gives a task enough time to exit monitoring loop and close database connection.
    await sleep(30000);
    logger.debug(Messages.get("MonitorImpl.stopped", this.hostInfo.host));
  }

  startMonitoring(context: MonitorConnectionContext): void {
    if (this.isStopped()) {
      logger.warn(Messages.get("MonitorImpl.monitorIsStopped", this.hostInfo.host));
    }

    const currentTimeNanos: number = this.getCurrentTimeNano();
    const startMonitorTimeNano = currentTimeNanos + this.failureDetectionTimeNano;
    const connectionQueue = MapUtils.computeIfAbsent(
      MonitorImpl.newContexts,
      startMonitorTimeNano,
      (k) => new Array<WeakRef<MonitorConnectionContext>>()
    );
    connectionQueue.push(new WeakRef<MonitorConnectionContext>(context));
  }

  async newContextRun(): Promise<void> {
    logger.debug(Messages.get("MonitorImpl.startMonitoringTaskNewContext", this.hostInfo.host));

    try {
      while (!this.isStopped()) {
        const currentTimeNanos = this.getCurrentTimeNano();
        // Get entries with key (that is a time in nanos) less or equal than current time.
        const processedKeys: number[] = new Array<number>();
        for (const [key, val] of MonitorImpl.newContexts.entries()) {
          if (key < currentTimeNanos) {
            const queue: Array<WeakRef<MonitorConnectionContext>> = val;
            processedKeys.push(key);
            // Each value of found entry is a queue of monitoring contexts awaiting active monitoring.
            // Add all contexts to an active monitoring contexts queue.
            // Ignore disposed contexts.
            let monitorContextRef: WeakRef<MonitorConnectionContext> | undefined;
            while ((monitorContextRef = queue.shift()) != null) {
              const monitorContext: MonitorConnectionContext = monitorContextRef.deref();
              if (monitorContext !== null && monitorContext.isActive()) {
                this.activeContexts.push(monitorContextRef);
              }
            }
          }
        }
        processedKeys.forEach((key) => {
          MonitorImpl.newContexts.delete(key);
        });
        await sleep(1000);
      }
      return;
    } catch (err) {
      // do nothing, exit task
    }
    logger.debug(Messages.get("MonitorImpl.stopMonitoringTaskNewContext", this.hostInfo.host));
  }

  async run(): Promise<void> {
    logger.debug(Messages.get("MonitorImpl.startMonitoring", this.hostInfo.host));

    try {
      while (!this.isStopped()) {
        try {
          while (this.activeContexts.length === 0 && !this.hostUnhealthy) {
            await sleep(MonitorImpl.TASK_SLEEP_NANOS / 1000000);
          }

          const statusCheckStartTimeNanos: number = this.getCurrentTimeNano();
          const isValid = await this.checkConnectionStatus();
          const statusCheckEndTimeNanos: number = this.getCurrentTimeNano();

          await this.updateHostHealthStatus(isValid, statusCheckStartTimeNanos, statusCheckEndTimeNanos);

          if (this.hostUnhealthy) {
            this.pluginService.setAvailability(this.hostInfo.aliases, HostAvailability.NOT_AVAILABLE);
          }
          const tmpActiveContexts: WeakRef<MonitorConnectionContext>[] = [];

          let monitorContextRef: WeakRef<MonitorConnectionContext> | undefined;

          while ((monitorContextRef = this.activeContexts.shift()) != null) {
            if (this.isStopped()) {
              break;
            }
            const monitorContext = monitorContextRef.deref();
            if (monitorContext == null) {
              continue;
            }

            if (this.hostUnhealthy) {
              // Kill connection
              monitorContext.setHostUnhealthy(true);
              monitorContext.setInactive();
              this.stopped = true;
              const connectionToAbort = monitorContext.getClient();
              if (connectionToAbort != null) {
                await this.endMonitoringClient();
                this.abortedConnectionsCounter.inc();
              }
            } else if (monitorContext.isActive()) {
              tmpActiveContexts.push(monitorContextRef);
            }

            // activeContexts is empty now and tmpActiveContexts contains all yet active contexts
            // Add active contexts back to the queue.
            this.activeContexts.push(...tmpActiveContexts);

            const delayNanos = this.failureDetectionIntervalNanos - (statusCheckEndTimeNanos - statusCheckStartTimeNanos);
            await sleep(delayNanos < MonitorImpl.TASK_SLEEP_NANOS ? MonitorImpl.TASK_SLEEP_NANOS / 1000000 : delayNanos / 1000000);
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
  async checkConnectionStatus(): Promise<boolean> {
    const connectContext = this.telemetryFactory.openTelemetryContext("Connection status check", TelemetryTraceLevel.FORCE_TOP_LEVEL);
    connectContext.setAttribute("url", this.hostInfo.host);
    return await connectContext.start(async () => {
      try {
        const clientIsValid = this.monitoringClient && (await this.pluginService.isClientValid(this.monitoringClient));

        if (this.monitoringClient === null && !clientIsValid) {
          // Open a new connection.
          const monitoringConnProperties: Map<string, any> = new Map(this.properties);

          for (const key of this.properties.keys()) {
            if (!key.startsWith(WrapperProperties.MONITORING_PROPERTY_PREFIX)) {
              continue;
            }

            monitoringConnProperties.set(key.substring(WrapperProperties.MONITORING_PROPERTY_PREFIX.length), this.properties.get(key));
            monitoringConnProperties.delete(key);
          }

          logger.debug(`Opening a monitoring connection to ${this.hostInfo.url}`);
          this.monitoringClient = await this.pluginService.forceConnect(this.hostInfo, monitoringConnProperties);
          logger.debug(`Successfully opened monitoring connection to ${this.monitoringClient.id} - ${this.hostInfo.url}`);
          return true;
        }
      } catch (error: any) {
        return false;
      }
    });
  }

  clearContexts(): void {
    this.activeContexts.length = 0;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  updateHostHealthStatus(connectionValid: boolean, statusCheckStartNano: number, statusCheckEndNano: number): Promise<void> {
    if (!connectionValid) {
      this.failureCount += 1;

      if (this.invalidHostStartTimeNano === 0) {
        this.invalidHostStartTimeNano = statusCheckStartNano;
      }

      const invalidHostDurationNano = statusCheckEndNano - this.invalidHostStartTimeNano;
      const maxInvalidHostDurationNano = this.failureDetectionIntervalNanos * Math.max(0, this.failureDetectionCount - 1);

      if (invalidHostDurationNano >= maxInvalidHostDurationNano) {
        logger.debug(Messages.get("MonitorConnectionContext.hostDead", this.hostInfo.host));
        this.hostUnhealthy = true;
        return Promise.resolve();
      }
      logger.debug(Messages.get("MonitorConnectionContext.hostNotResponding", this.hostInfo.host, this.failureCount.toString()));
      return Promise.resolve();
    }

    if (this.failureCount > 0) {
      // Host is back alive
      logger.debug(Messages.get("MonitorConnectionContext.hostAlive", this.hostInfo.host));
    }
    this.failureCount = 0;
    this.invalidHostStartTimeNano = 0;
    this.hostUnhealthy = false;
  }

  protected getCurrentTimeNano() {
    return Number(process.hrtime.bigint());
  }

  async releaseResources() {
    this.stopped = true;
    await this.endMonitoringClient();
    // Allow time for monitor loop to close.
    await sleep(500);
  }

  async endMonitoringClient() {
    if (this.monitoringClient) {
      await this.pluginService.abortTargetClient(this.monitoringClient);
      this.monitoringClient = null;
    }
  }
}
