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
import { AwsWrapperError, IllegalArgumentError } from "../../utils/errors";
import { Monitor, MonitorImpl } from "./monitor";
import { WrapperProperties } from "../../wrapper_property";
import { PluginService } from "../../plugin_service";
import { Messages } from "../../utils/messages";
import { SlidingExpirationCacheWithCleanupTask } from "../../utils/sliding_expiration_cache_with_cleanup_task";
import { ClientWrapper } from "../../client_wrapper";

export interface MonitorService {
  startMonitoring(
    clientToAbort: ClientWrapper,
    hostKeys: Set<string>,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number
  ): Promise<MonitorConnectionContext>;

  stopMonitoring(context: MonitorConnectionContext): Promise<void>;

  stopMonitoringForAllConnections(hostKeys: Set<string>): void;

  releaseResources(): Promise<void>;
}

export class MonitorServiceImpl implements MonitorService {
  private static readonly CACHE_CLEANUP_NANOS = BigInt(60_000_000_000);
  protected static readonly monitors: SlidingExpirationCacheWithCleanupTask<string, Monitor> = new SlidingExpirationCacheWithCleanupTask(
    MonitorServiceImpl.CACHE_CLEANUP_NANOS,
    undefined,
    async (monitor: Monitor) => {
      await monitor.releaseResources();
    }
  );
  private readonly pluginService: PluginService;
  private cachedMonitorHostKeys: Set<string> | undefined;
  private cachedMonitorRef: WeakRef<Monitor> | undefined;
  monitorSupplier = (pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, monitorDisposalTimeMillis: number) =>
    new MonitorImpl(pluginService, hostInfo, properties, monitorDisposalTimeMillis);

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
  }

  async startMonitoring(
    clientToAbort: ClientWrapper,
    hostKeys: Set<string>,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number
  ): Promise<MonitorConnectionContext> {
    if (hostKeys.size === 0) {
      throw new IllegalArgumentError(Messages.get("MonitorService.emptyAliasSet", hostInfo.host));
    }

    let monitor: Monitor | null = this.cachedMonitorRef?.deref() ?? null;

    if (!monitor || (monitor && monitor.isStopped()) || this.cachedMonitorHostKeys?.size === 0 || this.cachedMonitorHostKeys !== hostKeys) {
      monitor = await this.getMonitor(hostKeys, hostInfo, properties);
      if (monitor) {
        this.cachedMonitorRef = new WeakRef(monitor);
        this.cachedMonitorHostKeys = hostKeys;
      }
    }

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const abortedConnectionsCounter = telemetryFactory.createCounter("efm.connections.aborted");

    if (monitor) {
      const context = new MonitorConnectionContext(
        monitor,
        clientToAbort,
        failureDetectionTimeMillis,
        failureDetectionIntervalMillis,
        failureDetectionCount,
        this.pluginService,
        abortedConnectionsCounter
      );
      monitor.startMonitoring(context);
      return context;
    }

    throw new AwsWrapperError(Messages.get("MonitorService.startMonitoringNullMonitor", hostInfo.host));
  }

  async stopMonitoring(context: MonitorConnectionContext) {
    context.monitor.stopMonitoring(context);
    await context.monitor.endMonitoringClient();
  }

  stopMonitoringForAllConnections(hostKeys: Set<string>) {
    let monitor: Monitor;
    for (const hostKey of hostKeys) {
      monitor = MonitorServiceImpl.monitors.get(hostKey);
      if (monitor) {
        monitor.clearContexts();
        return;
      }
    }
  }

  async getMonitor(hostKeys: Set<string>, hostInfo: HostInfo, properties: Map<string, any>): Promise<Monitor | null> {
    let monitor: Monitor;
    let anyHostKey: string;
    for (const hostKey of hostKeys) {
      monitor = MonitorServiceImpl.monitors.get(hostKey);
      anyHostKey = hostKey;
      if (monitor) {
        break;
      }
    }

    const cacheExpirationNanos = BigInt(WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties) * 1_000_000);
    if (anyHostKey && (!monitor || (monitor && monitor.isStopped()))) {
      monitor = MonitorServiceImpl.monitors.computeIfAbsent(
        anyHostKey,
        () => this.monitorSupplier(this.pluginService, hostInfo, properties, WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties)),
        cacheExpirationNanos
      );

      if (monitor && monitor.isStopped()) {
        await monitor.releaseResources();
        MonitorServiceImpl.monitors.remove(anyHostKey);
        monitor = this.monitorSupplier(this.pluginService, hostInfo, properties, WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties));
      }
    }

    if (monitor) {
      this.populateMonitorMap(hostKeys, monitor, cacheExpirationNanos);
      return monitor;
    }

    return null;
  }

  private populateMonitorMap(hostKeys: Set<string>, monitor: Monitor, cacheExpirationNanos: bigint) {
    for (const hostKey of hostKeys) {
      MonitorServiceImpl.monitors.putIfAbsent(hostKey, monitor, cacheExpirationNanos);
    }
  }

  async releaseResources() {
    await MonitorServiceImpl.monitors.clear();
    this.cachedMonitorHostKeys = undefined;
    this.cachedMonitorRef = undefined;
  }

  // Used for performance testing.
  static async clearMonitors() {
    await MonitorServiceImpl.monitors.clear();
  }
}
