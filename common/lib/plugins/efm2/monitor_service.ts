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
import { AwsWrapperError } from "../../utils/errors";
import { Monitor, MonitorImpl } from "./monitor";
import { WrapperProperties } from "../../wrapper_property";
import { PluginService } from "../../plugin_service";
import { Messages } from "../../utils/messages";
import { TelemetryCounter } from "../../utils/telemetry/telemetry_counter";
import { TelemetryFactory } from "../../utils/telemetry/telemetry_factory";
import { ClientWrapper } from "../../client_wrapper";
import { logger } from "../../../logutils";
import { SlidingExpirationCacheWithCleanupTask } from "../../utils/sliding_expiration_cache_with_cleanup_task";

export interface MonitorService {
  startMonitoring(
    clientToAbort: ClientWrapper,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number
  ): Promise<MonitorConnectionContext>;

  /**
   * Stop monitoring for a connection represented by the given {@link MonitorConnectionContext}.
   * Removes the context from the {@link MonitorImpl}.
   *
   * @param context The {@link MonitorConnectionContext} representing a connection.
   * @param clientToAbort A reference to the connection associated with this context that will be aborted.
   */
  stopMonitoring(context: MonitorConnectionContext, clientToAbort: ClientWrapper): Promise<void>;

  releaseResources(): Promise<void>;
}

export class MonitorServiceImpl implements MonitorService {
  private static readonly CACHE_CLEANUP_NANOS = BigInt(60_000_000_000);

  protected static readonly monitors: SlidingExpirationCacheWithCleanupTask<string, Monitor> = new SlidingExpirationCacheWithCleanupTask(
    MonitorServiceImpl.CACHE_CLEANUP_NANOS,
    (monitor: Monitor) => monitor.canDispose(),
    async (monitor: Monitor) => {
      {
        try {
          await monitor.releaseResources();
        } catch (error) {
          // ignore
        }
      }
    },
    "efm2/MonitorServiceImpl.monitors"
  );
  private readonly pluginService: PluginService;
  private telemetryFactory: TelemetryFactory;
  private readonly abortedConnectionsCounter: TelemetryCounter;
  monitorSupplier = (
    pluginService: PluginService,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number,
    abortedConnectionsCounter: TelemetryCounter
  ) =>
    new MonitorImpl(
      pluginService,
      hostInfo,
      properties,
      failureDetectionTimeMillis,
      failureDetectionIntervalMillis,
      failureDetectionCount,
      abortedConnectionsCounter
    );

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
    this.telemetryFactory = pluginService.getTelemetryFactory();
    this.abortedConnectionsCounter = this.telemetryFactory.createCounter("efm2.connections.aborted");
  }

  async startMonitoring(
    clientToAbort: ClientWrapper,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number
  ): Promise<MonitorConnectionContext> {
    const monitor = await this.getMonitor(hostInfo, properties, failureDetectionTimeMillis, failureDetectionIntervalMillis, failureDetectionCount);

    if (monitor) {
      const context = new MonitorConnectionContext(clientToAbort);
      monitor.startMonitoring(context);
      return context;
    }

    throw new AwsWrapperError(Messages.get("MonitorService.startMonitoringNullMonitor", hostInfo.host));
  }

  async stopMonitoring(context: MonitorConnectionContext, clientToAbort: ClientWrapper): Promise<void> {
    context.setInactive();
    if (context.shouldAbort()) {
      try {
        await clientToAbort.abort();
        this.abortedConnectionsCounter.inc();
      } catch (error) {
        // ignore
        logger.debug(Messages.get("MonitorConnectionContext.errorAbortingConnection", error.message));
      }
    }
  }

  async getMonitor(
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number
  ): Promise<Monitor | null> {
    const monitorKey: string = `${failureDetectionTimeMillis.toString()} ${failureDetectionIntervalMillis.toString()} ${failureDetectionCount.toString()} ${hostInfo.host}`;
    const cacheExpirationNanos = BigInt(WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties) * 1_000_000);
    return MonitorServiceImpl.monitors.computeIfAbsent(
      monitorKey,
      () =>
        this.monitorSupplier(
          this.pluginService,
          hostInfo,
          properties,
          failureDetectionTimeMillis,
          failureDetectionIntervalMillis,
          failureDetectionCount,
          this.abortedConnectionsCounter
        ),
      cacheExpirationNanos
    );
  }

  async releaseResources() {
    await MonitorServiceImpl.monitors.clear();
  }
}
