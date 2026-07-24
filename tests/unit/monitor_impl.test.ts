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

import { HostMonitorImpl } from "../../common/lib/plugins/efm/base/host_monitor";
import { ConnectionContextImpl } from "../../common/lib/plugins/efm/base/connection_context";
import { anything, instance, mock, reset, when } from "ts-mockito";
import { PluginService, PluginServiceImpl } from "../../common/lib/plugin_service";
import { HostInfo } from "../../common/lib";
import { sleep } from "../../common/lib/utils/utils";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";

class MonitorImplTest extends HostMonitorImpl {
  constructor(pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, monitorDisposalTimeMillis: number) {
    super(pluginService, hostInfo, properties, monitorDisposalTimeMillis);
  }

  override checkConnectionStatus() {
    // Exposes the protected checkConnectionStatus method for testing purposes.
    return super.checkConnectionStatus();
  }
}

const mockPluginService = mock(PluginServiceImpl);
const mockHostInfo = mock(HostInfo);
const mockClientWrapper: ClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

const SHORT_INTERVAL_MILLIS = 30;

const properties = new Map();
let monitor: MonitorImplTest;

describe("monitor impl test", () => {
  beforeEach(() => {
    reset(mockPluginService);

    when(mockPluginService.forceConnect(anything(), anything())).thenResolve(mockClientWrapper);
    when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());

    monitor = new MonitorImplTest(instance(mockPluginService), instance(mockHostInfo), properties, 0);
  });

  afterEach(async () => {
    await monitor.releaseResources();
  });

  it("is client healthy with no existing client", async () => {
    const [isValid, elapsedTimeNano] = await monitor.checkConnectionStatus();

    expect(isValid).toBe(true);
    expect(elapsedTimeNano).toBeGreaterThanOrEqual(0);
  });

  it("is client healthy with existing client", async () => {
    when(mockPluginService.isClientValid(anything())).thenResolve(false).thenResolve(true).thenResolve(true);

    // Start up a monitoring client.
    await monitor.checkConnectionStatus();

    const [isValid1] = await monitor.checkConnectionStatus();
    expect(isValid1).toBe(true);

    const [isValid2] = await monitor.checkConnectionStatus();
    expect(isValid2).toBe(true);
  });

  it("is client healthy with error", async () => {
    when(mockPluginService.isClientValid(anything())).thenThrow(new Error());

    // Start up a monitoring client.
    await monitor.checkConnectionStatus();

    const [isValid, elapsedTimeNano] = await monitor.checkConnectionStatus();
    expect(isValid).toBe(false);
    expect(elapsedTimeNano).toBeGreaterThanOrEqual(0);
  });

  it("run without context", async () => {
    // Should end by itself (monitorDisposalTimeMillis = 0).
    await monitor.run();
  });

  it("run with context", async () => {
    when(mockPluginService.isClientValid(anything())).thenResolve(true);

    const context = new ConnectionContextImpl(mockClientWrapper, 30000, 5000, 3, new NullTelemetryFactory().createCounter("counter"));
    monitor.startMonitoring(context);
    monitor.run();
    await sleep(SHORT_INTERVAL_MILLIS);
    monitor.stopMonitoring(context);
  });
});
