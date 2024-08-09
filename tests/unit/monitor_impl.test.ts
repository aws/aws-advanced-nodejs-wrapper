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

import { MonitorImpl } from "../../common/lib/plugins/efm/monitor";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { PluginService } from "../../common/lib/plugin_service";
import { HostInfo } from "../../common/lib/host_info";
import { AwsClient } from "../../common/lib/aws_client";
import { MonitorConnectionContext } from "../../common/lib/plugins/efm/monitor_connection_context";
import { sleep } from "../../common/lib/utils/utils";
import { ClientWrapper } from "../../common/lib/client_wrapper";

class MonitorImplTest extends MonitorImpl {
  constructor(pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, monitorDisposalTimeMillis: number) {
    super(pluginService, hostInfo, properties, monitorDisposalTimeMillis);
  }

  override startRun() {
    // do nothing
  }
}

const mockPluginService = mock(PluginService);
const mockHostInfo = mock(HostInfo);
const mockClient = mock(AwsClient);
const clientWrapper: ClientWrapper = {
  client: undefined,
  hostInfo: mock(HostInfo),
  properties: new Map<string, any>()
};
const mockClientWrapper: ClientWrapper = mock(clientWrapper);

const SHORT_INTERVAL_MILLIS = 30;

const properties = new Map();
let monitor: MonitorImpl;
let monitorSpy: MonitorImpl;

describe("monitor impl test", () => {
  beforeEach(() => {
    reset(mockPluginService);

    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClient));
    when(mockPluginService.forceConnect(anything(), anything())).thenResolve(mockClientWrapper);

    monitor = new MonitorImplTest(instance(mockPluginService), instance(mockHostInfo), properties, 0);
    monitorSpy = spy(monitor);
  });

  afterEach(() => {
    monitor.releaseResources();
  });

  it("is client healthy with no existing client", async () => {
    const status = await monitor.checkConnectionStatus();

    verify(mockPluginService.forceConnect(anything(), anything())).once();
    expect(status.isValid).toBe(true);
    expect(status.elapsedTimeNano).toBeGreaterThanOrEqual(0);
  });

  it("is client healthy with existing client", async () => {
    when(mockPluginService.isClientValid(anything())).thenResolve(false).thenResolve(true).thenResolve(true);

    // Start up a monitoring client.
    await monitor.checkConnectionStatus();

    const status1 = await monitor.checkConnectionStatus();
    expect(status1.isValid).toBe(true);

    const status2 = await monitor.checkConnectionStatus();
    expect(status2.isValid).toBe(true);

    verify(mockPluginService.isClientValid(mockClientWrapper)).twice();
  });

  it("is client healthy with error", async () => {
    when(mockPluginService.isClientValid(anything())).thenThrow(new Error());

    // Start up a monitoring client.
    await monitor.checkConnectionStatus();

    const status = await monitor.checkConnectionStatus();
    expect(status.isValid).toBe(false);
    expect(status.elapsedTimeNano).toBeGreaterThanOrEqual(0);
  });

  it("run without context", async () => {
    // Should end by itself.
    await monitor.run();
    verify(monitorSpy.checkConnectionStatus()).never();
  });

  it("run with context", async () => {
    const monitorContextInstance = new MonitorConnectionContext(monitor, mockClient, 30000, 5000, 3);
    monitor.startMonitoring(monitorContextInstance);
    // Should end by itself.
    monitor.run();
    await sleep(SHORT_INTERVAL_MILLIS);
    monitor.stopMonitoring(monitorContextInstance);
  });
});
