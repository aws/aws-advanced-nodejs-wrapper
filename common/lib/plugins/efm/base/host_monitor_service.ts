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
import { ClientWrapper } from "../../../client_wrapper";
import { WrapperProperties } from "../../../wrapper_property";
import { AwsWrapperError } from "../../../utils/errors";
import { Messages } from "../../../utils/messages";
import { MonitorService } from "../../../utils/monitoring/monitor_service";
import { MonitorInitializer } from "../../../utils/monitoring/monitor";
import { TelemetryCounter } from "../../../utils/telemetry/telemetry_counter";
import { FullServicesContainer } from "../../../utils/full_services_container";

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

export class HostMonitorServiceImpl implements HostMonitorService {
  private static readonly MONITOR_DISPOSAL_TIME_NS = BigInt(10 * 60 * 1_000_000_000); // 10 minutes
  private static readonly INACTIVE_TIMEOUT_NS = BigInt(3 * 60 * 1_000_000_000); // 3 minutes

  private readonly servicesContainer: FullServicesContainer;
  private readonly coreMonitorService: MonitorService;
  private readonly contextPool: ContextPool;
  private readonly abortedConnectionsCounter: TelemetryCounter;

  constructor(servicesContainer: FullServicesContainer, contextPool?: ContextPool) {
    this.servicesContainer = servicesContainer;
    this.coreMonitorService = servicesContainer.monitorService;
    this.contextPool = contextPool ?? new ContextPoolImpl();
    const telemetryFactory = servicesContainer.telemetryFactory;
    this.abortedConnectionsCounter = telemetryFactory.createCounter("efm.connections.aborted");

    this.coreMonitorService.registerMonitorTypeIfAbsent(
      HostMonitorImpl,
      HostMonitorServiceImpl.MONITOR_DISPOSAL_TIME_NS,
      HostMonitorServiceImpl.INACTIVE_TIMEOUT_NS,
      new Set(),
      undefined
    );
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

    const monitor = await this.getMonitor(monitorKey, hostInfo, properties);

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

  private async getMonitor(monitorKey: string, hostInfo: HostInfo, properties: Map<string, any>): Promise<HostMonitor> {
    const monitorDisposalTimeMillis = WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(properties);

    const initializer: MonitorInitializer = {
      createMonitor: () =>
        new HostMonitorImpl(this.servicesContainer.pluginService, hostInfo, properties, monitorDisposalTimeMillis, this.contextPool)
    };

    return await this.coreMonitorService.runIfAbsent(HostMonitorImpl, monitorKey, this.servicesContainer, properties, initializer);
  }

  async releaseResources(): Promise<void> {
    await this.coreMonitorService.stopAndRemoveMonitors(HostMonitorImpl);
    this.contextPool.clearAll();
  }

  static async clearMonitors(monitorService: MonitorService): Promise<void> {
    await monitorService.stopAndRemoveMonitors(HostMonitorImpl);
  }
}
