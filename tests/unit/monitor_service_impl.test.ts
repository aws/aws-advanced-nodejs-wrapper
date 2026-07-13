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

import { instance, mock, reset, when } from "ts-mockito";
import { HostMonitorServiceImpl } from "../../common/lib/plugins/efm/base/host_monitor_service";
import { HostMonitorImpl } from "../../common/lib/plugins/efm/base/host_monitor";
import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { HostInfo, HostInfoBuilder } from "../../common/lib";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { MonitorServiceImpl } from "../../common/lib/utils/monitoring/monitor_service";
import { FullServicesContainer } from "../../common/lib/utils/full_services_container";
import { BatchingEventPublisher } from "../../common/lib/utils/events/batching_event_publisher";
import { WrapperProperties } from "../../common/lib/wrapper_property";

const FAILURE_DETECTION_TIME_MILLIS = 10;
const FAILURE_DETECTION_INTERVAL_MILLIS = 100;
const FAILURE_DETECTION_COUNT = 3;

const mockPluginService = mock(PluginServiceImpl);

const properties: Map<string, any> = new Map();
properties.set(WrapperProperties.MONITOR_DISPOSAL_TIME_MS.name, 600000);

let monitorService: HostMonitorServiceImpl;
let coreMonitorService: MonitorServiceImpl;
let servicesContainer: FullServicesContainer;
let eventPublisher: BatchingEventPublisher;

describe("monitor service impl test", () => {
  beforeEach(() => {
    reset(mockPluginService);

    const telemetryFactory = new NullTelemetryFactory();
    when(mockPluginService.getTelemetryFactory()).thenReturn(telemetryFactory);
    when(mockPluginService.isClientValid(undefined)).thenResolve(false);

    eventPublisher = new BatchingEventPublisher(60_000);
    coreMonitorService = new MonitorServiceImpl(eventPublisher);

    servicesContainer = {
      pluginService: instance(mockPluginService),
      monitorService: coreMonitorService,
      telemetryFactory: telemetryFactory
    } as unknown as FullServicesContainer;

    monitorService = new HostMonitorServiceImpl(servicesContainer);
  });

  afterEach(async () => {
    await monitorService.releaseResources();
    await coreMonitorService.releaseResources();
    eventPublisher.releaseResources();
  });

  it("start monitoring creates context", async () => {
    const hostInfo = new HostInfoBuilder({ host: "test-host", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build();
    const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

    const context = await monitorService.startMonitoring(
      mockClientWrapper,
      hostInfo,
      properties,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    expect(context).toBeDefined();
    expect(context).not.toBeNull();
    expect(context.isActiveContext()).toBe(true);
    expect(context.isHostUnhealthy()).toBe(false);
  });

  it("stop monitoring sets context inactive", async () => {
    const hostInfo = new HostInfoBuilder({ host: "test-host", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build();
    const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

    const context = await monitorService.startMonitoring(
      mockClientWrapper,
      hostInfo,
      properties,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    monitorService.stopMonitoring(context);
    expect(context.isActiveContext()).toBe(false);
  });

  it("start monitoring reuses monitor for same host", async () => {
    const hostInfo = new HostInfoBuilder({ host: "test-host", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build();
    const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

    await monitorService.startMonitoring(
      mockClientWrapper,
      hostInfo,
      properties,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    const monitor1 = coreMonitorService.get(HostMonitorImpl, hostInfo.host);

    await monitorService.startMonitoring(
      mockClientWrapper,
      hostInfo,
      properties,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    const monitor2 = coreMonitorService.get(HostMonitorImpl, hostInfo.host);
    expect(monitor2).toBe(monitor1);
  });

  it("start monitoring creates separate monitors for different hosts", async () => {
    const hostInfoA = new HostInfoBuilder({ host: "host-a", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build();
    const hostInfoB = new HostInfoBuilder({ host: "host-b", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build();
    const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

    await monitorService.startMonitoring(
      mockClientWrapper,
      hostInfoA,
      properties,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    await monitorService.startMonitoring(
      mockClientWrapper,
      hostInfoB,
      properties,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    const monitorA = coreMonitorService.get(HostMonitorImpl, hostInfoA.host);
    const monitorB = coreMonitorService.get(HostMonitorImpl, hostInfoB.host);
    expect(monitorA).not.toBe(monitorB);
  });

  it("release resources clears monitors", async () => {
    const hostInfo = new HostInfoBuilder({ host: "test-host", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build();
    const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

    await monitorService.startMonitoring(
      mockClientWrapper,
      hostInfo,
      properties,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    await monitorService.releaseResources();

    const monitor = coreMonitorService.get(HostMonitorImpl, hostInfo.host);
    expect(monitor).toBeNull();
  });
});
