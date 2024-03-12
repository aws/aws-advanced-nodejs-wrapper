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

import { anything, capture, instance, mock, reset, verify } from "ts-mockito";
import { MonitorImpl } from "../../common/lib/plugins/efm/monitor";
import { MonitorServiceImpl } from "../../common/lib/plugins/efm/monitor_service";
import { PluginService } from "../../common/lib/plugin_service";
import { HostInfo } from "../../common/lib/host_info";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";

class MonitorImplTest extends MonitorImpl {
  constructor(pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, monitorDisposalTimeMillis: number) {
    super(pluginService, hostInfo, properties, monitorDisposalTimeMillis);
  }

  override startRun() {
    // do nothing
  }
}

const mockPluginService = mock(PluginService);
const mockMonitorA = mock(MonitorImpl);
const mockMonitorB = mock(MonitorImpl);
const mockHostInfo = mock(HostInfo);
const mockTargetClient = {};

const FAILURE_DETECTION_TIME_MILLIS = 10;
const FAILURE_DETECTION_INTERVAL_MILLIS = 100;
const FAILURE_DETECTION_COUNT = 3;
const NODE_KEYS = new Set(["any"]);
const properties = new Map();

let monitorService: MonitorServiceImpl;

describe("monitor service impl test", () => {
  beforeEach(() => {
    reset(mockPluginService);
    reset(mockMonitorA);

    monitorService = new MonitorServiceImpl(instance(mockPluginService));
    monitorService.monitorSupplier = () => new MonitorImplTest(instance(mockPluginService), instance(mockHostInfo), properties, 0);
  });

  it("start monitoring", async () => {
    monitorService.monitorSupplier = () => instance(mockMonitorA);

    await monitorService.startMonitoring(
      mockTargetClient,
      NODE_KEYS,
      instance(mockHostInfo),
      new Map(),
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );
    const arg = capture(mockMonitorA.startMonitoring).last();
    expect(arg).toBeDefined();
    expect(arg).not.toBeNull();
  });

  it("start monitoring called multiple times", async () => {
    monitorService.monitorSupplier = () => instance(mockMonitorA);

    const runs = 5;

    for (let i = 0; i < runs; i++) {
      await monitorService.startMonitoring(
        mockTargetClient,
        NODE_KEYS,
        instance(mockHostInfo),
        new Map(),
        FAILURE_DETECTION_TIME_MILLIS,
        FAILURE_DETECTION_INTERVAL_MILLIS,
        FAILURE_DETECTION_COUNT
      );
      const arg = capture(mockMonitorA.startMonitoring).last();
      expect(arg).toBeDefined();
      expect(arg).not.toBeNull();
    }
  });

  it("start and stop monitoring", async () => {
    monitorService.monitorSupplier = () => instance(mockMonitorA);

    const context = await monitorService.startMonitoring(
      mockTargetClient,
      NODE_KEYS,
      instance(mockHostInfo),
      new Map(),
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );
    await monitorService.stopMonitoring(context);

    const arg = capture(mockMonitorA.startMonitoring).last();
    expect(arg[0]).toBe(context);
    verify(mockMonitorA.stopMonitoring(anything())).once();
  });

  it("stop monitoring called twice", async () => {
    monitorService.monitorSupplier = () => instance(mockMonitorA);

    const context = await monitorService.startMonitoring(
      mockTargetClient,
      NODE_KEYS,
      instance(mockHostInfo),
      new Map(),
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );
    await monitorService.stopMonitoring(context);

    const arg = capture(mockMonitorA.startMonitoring).last();
    expect(arg[0]).toBe(context);

    await monitorService.stopMonitoring(context);
    verify(mockMonitorA.stopMonitoring(anything())).twice();
  });

  it("stop monitoring for all connections with invalid node keys", async () => {
    monitorService.stopMonitoringForAllConnections(new Set());
    monitorService.stopMonitoringForAllConnections(new Set(["foo"]));
  });

  it("stop monitoring for all connections", async () => {
    const keysA = new Set(["monitorA"]);
    const keysB = new Set(["monitorB"]);

    monitorService.monitorSupplier = () => instance(mockMonitorA);
    await monitorService.getMonitor(
      keysA,
      new HostInfoBuilder({ host: "test", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build(),
      properties
    );

    monitorService.monitorSupplier = () => instance(mockMonitorB);
    await monitorService.getMonitor(
      keysB,
      new HostInfoBuilder({ host: "test", hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).build(),
      properties
    );

    monitorService.stopMonitoringForAllConnections(keysA);
    verify(mockMonitorA.clearContexts()).once();

    monitorService.stopMonitoringForAllConnections(keysB);
    verify(mockMonitorB.clearContexts()).once();
  });

  it("getMonitor called with multiple hosts in keys", async () => {
    const keysA = new Set(["host1.domain", "host2.domain"]);
    const keysB = new Set(["host2.domain"]);

    const monitorOne = await monitorService.getMonitor(keysA, instance(mockHostInfo), properties);
    expect(monitorOne).not.toBeNull();

    const monitorOneDupe = await monitorService.getMonitor(keysB, instance(mockHostInfo), properties);
    expect(monitorOneDupe).toBe(monitorOne);
  });

  it("getMonitor called with different host keys", async () => {
    const keys = new Set(["hostNEW.domain"]);

    const monitorOne = await monitorService.getMonitor(keys, instance(mockHostInfo), properties);
    expect(monitorOne).not.toBeNull();

    const monitorOneDupe = await monitorService.getMonitor(keys, instance(mockHostInfo), properties);
    expect(monitorOneDupe).toBe(monitorOne);

    const monitorTwo = await monitorService.getMonitor(NODE_KEYS, instance(mockHostInfo), properties);
    expect(monitorTwo).not.toBeNull();
    expect(monitorTwo).not.toBe(monitorOne);
  });

  it("getMonitor called with same keys in different sets", async () => {
    const keysA = new Set(["hostA"]);
    const keysB = new Set(["hostA", "hostB"]);
    const keysC = new Set(["hostB"]);

    const monitorOne = await monitorService.getMonitor(keysA, instance(mockHostInfo), properties);
    expect(monitorOne).not.toBeNull();

    const monitorOneDupe = await monitorService.getMonitor(keysB, instance(mockHostInfo), properties);
    expect(monitorOneDupe).toBe(monitorOne);

    const monitorOneDupeTwo = await monitorService.getMonitor(keysC, instance(mockHostInfo), properties);
    expect(monitorOneDupeTwo).toBe(monitorOne);
  });

  it("startMonitoring with no host keys", async () => {
    const keys: Set<string> = new Set();
    expect(await monitorService.getMonitor(keys, instance(mockHostInfo), properties)).toBeNull();
  });
});
