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

import { ConnectionContext, ConnectionContextImpl } from "./connection_context";
import { ContextPool, ContextPoolImpl } from "./context_pool";
import { HostMonitor, HostMonitorImpl } from "./host_monitor";
import { HostInfo } from "../../../host_info";
import { PluginService } from "../../../plugin_service";
import { ClientWrapper } from "../../../client_wrapper";
import { WrapperProperties } from "../../../wrapper_property";
import { AwsWrapperError } from "../../../utils/errors";
import { Messages } from "../../../utils/messages";
import { SlidingExpirationCacheWithCleanupTask } from "../../../utils/sliding_expiration_cache_with_cleanup_task";
import { TelemetryCounter } from "../../../utils/telemetry/telemetry_counter";

export interface HostMonitorService {
  startMonitoring(
    connectionToAbort: ClientWrapper,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number
  ): Promise<ConnectionContext>;

  stopMonitoring(context: ConnectionContext): void;

  releaseResources(): Promise<void>;
}

export type HostMonitorInitializer = (
  pluginService: PluginService,
  hostInfo: HostInfo,
  properties: Map<string, any>,
  monitorDisposalTimeMillis: number,
  contextPool: ContextPool
) => HostMonitor;

export class HostMonitorServiceImpl implements HostMonitorService {
  private static readonly CACHE_CLEANUP_NANOS = BigInt(60_000_000_000);

  protected static readonly monitors: SlidingExpirationCacheWithCleanupTask<string, HostMonitor> =
    new SlidingExpirationCacheWithCleanupTask(
      HostMonitorServiceImpl.CACHE_CLEANUP_NANOS,
      undefined,
      async (monitor: HostMonitor) => {
        await monitor.releaseResources();
      },
      "efm/HostMonitorServiceImpl.monitors"
    );

  private readonly pluginService: PluginService;
  private readonly contextPool: ContextPool;
  private readonly abortedConnectionsCounter: TelemetryCounter;
  private cachedMonitorKey: string | undefined;
  private cachedMonitorRef: WeakRef<HostMonitor> | undefined;

  monitorInitializer: HostMonitorInitializer = (pluginService, hostInfo, properties, monitorDisposalTimeMillis, contextPool) =>
    new HostMonitorImpl(pluginService, hostInfo, properties, monitorDisposalTimeMillis, contextPool);

  constructor(pluginService: PluginService, contextPool?: ContextPool) {
    this.pluginService = pluginService;
    this.contextPool = contextPool ?? new ContextPoolImpl();
    const telemetryFactory = this.pluginService.getTelemetryFactory();
    this.abortedConnectionsCounter = telemetryFactory.createCounter("efm.connections.aborted");
  }

  async startMonitoring(
    connectionToAbort: ClientWrapper,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number
  ): Promise<ConnectionContext> {
    const monitorKey = hostInfo.hostId || hostInfo.host;

    let monitor: HostMonitor | null = this.cachedMonitorRef?.deref() ?? null;

    if (!monitor || monitor.isStopped() || this.cachedMonitorKey !== monitorKey) {
      monitor = await this.getMonitor(monitorKey, hostInfo, properties);
      if (monitor) {
        this.cachedMonitorRef = new WeakRef(monitor);
        this.cachedMonitorKey = monitorKey;
      }
    }

    if (!monitor) {
      throw new AwsWrapperError(Messages.get("MonitorService.startMonitoringNullMonitor", hostInfo.host));
    }

    const context = new ConnectionContextImpl(
      connectionToAbort,
      failureDetectionTimeMillis,
      failureDetectionIntervalMillis,
      failureDetectionCount,
      this.abortedConnectionsCounter
    );

    monitor.startMonitoring(context);
    return context;
  }

  stopMonitoring(context: ConnectionContext): void {
    context.setInactive();
  }

  private async getMonitor(monitorKey: string, hostInfo: HostInfo, properties: Map<string, any>): Promise<HostMonitor | null> {
    let monitor = HostMonitorServiceImpl.monitors.get(monitorKey);

    const cacheExpirationNanos = BigInt(WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties) * 1_000_000);

    if (!monitor || monitor.isStopped()) {
      monitor = HostMonitorServiceImpl.monitors.computeIfAbsent(
        monitorKey,
        () =>
          this.monitorInitializer(
            this.pluginService,
            hostInfo,
            properties,
            WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties),
            this.contextPool
          ),
        cacheExpirationNanos
      );

      if (monitor && monitor.isStopped()) {
        await monitor.releaseResources();
        HostMonitorServiceImpl.monitors.remove(monitorKey);
        monitor = this.monitorInitializer(
          this.pluginService,
          hostInfo,
          properties,
          WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties),
          this.contextPool
        );
        HostMonitorServiceImpl.monitors.computeIfAbsent(monitorKey, () => monitor!, cacheExpirationNanos);
      }
    }

    return monitor ?? null;
  }

  async releaseResources(): Promise<void> {
    await HostMonitorServiceImpl.monitors.clear();
    this.contextPool.clearAll();
    this.cachedMonitorKey = undefined;
    this.cachedMonitorRef = undefined;
  }

  static async clearMonitors(): Promise<void> {
    await HostMonitorServiceImpl.monitors.clear();
  }
}
