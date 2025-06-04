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

import { WrapperProperties } from "../../common/lib/wrapper_property";
import { anything, instance, mock, spy, verify, when } from "ts-mockito";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { RDSClient } from "@aws-sdk/client-rds";
import { CustomEndpointPlugin } from "../../common/lib/plugins/custom_endpoint/custom_endpoint_plugin";
import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { CustomEndpointMonitorImpl } from "../../common/lib/plugins/custom_endpoint/custom_endpoint_monitor_impl";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { AwsWrapperError } from "../../common/lib/utils/errors";

const mockRdsClientFunc = () => instance(mock(RDSClient));
const mockPluginService = mock(PluginServiceImpl);
when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());
const mockMonitor = mock(CustomEndpointMonitorImpl);

const props = new Map();
const writerClusterHost = new HostInfoBuilder({
  host: "writer.cluster-XYZ.us-east-1.rds.amazonaws.com",
  port: 1234,
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
}).build();
const host = new HostInfoBuilder({
  host: "custom.cluster-custom-XYZ.us-east-1.rds.amazonaws.com",
  port: 1234,
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
}).build();

let connectCounter = 0;
function mockConnectFunc(): Promise<any> {
  connectCounter++;
  return Promise.resolve();
}
let executeCounter = 0;
function mockExecuteFunc(): Promise<any> {
  executeCounter++;
  return Promise.resolve();
}

function getPlugins() {
  const plugin = new CustomEndpointPlugin(instance(mockPluginService), props, mockRdsClientFunc);
  const spyPlugin = spy(plugin);
  when(spyPlugin.createMonitorIfAbsent(anything())).thenReturn(instance(mockMonitor));
  return [plugin, spyPlugin];
}

class TestCustomEndpointPlugin extends CustomEndpointPlugin {
  static getMonitors() {
    return TestCustomEndpointPlugin.monitors;
  }
}

describe("testCustomEndpoint", () => {
  beforeEach(() => {
    connectCounter = 0;
    executeCounter = 0;
    props.clear();
  });

  it("testConnect_monitorNotCreatedIfNotCustomEndpointHost", async () => {
    const [plugin, spyPlugin] = getPlugins();
    await plugin.connect(writerClusterHost, props, true, mockConnectFunc);

    expect(connectCounter).toBe(1);
    verify(spyPlugin.createMonitorIfAbsent(anything())).never();
  });

  it("testConnect_monitorCreated", async () => {
    when(mockMonitor.hasCustomEndpointInfo()).thenReturn(true);
    const [plugin, spyPlugin] = getPlugins();

    await plugin.connect(host, props, true, mockConnectFunc);
    expect(connectCounter).toBe(1);
    verify(spyPlugin.createMonitorIfAbsent(anything())).once();
  });

  it("testConnect_timeoutWaitingForInfo", async () => {
    props.set(WrapperProperties.WAIT_FOR_CUSTOM_ENDPOINT_INFO_TIMEOUT_MS.name, 1);
    when(mockMonitor.hasCustomEndpointInfo()).thenReturn(false);
    const [plugin, spyPlugin] = getPlugins();

    await expect(plugin.connect(host, props, true, mockConnectFunc)).rejects.toThrow(AwsWrapperError);
    expect(connectCounter).toBe(0);
    verify(spyPlugin.createMonitorIfAbsent(anything())).once();
  });

  it("testExecute_monitorNotCreatedIfNotCustomEndpointHost", async () => {
    when(mockMonitor.hasCustomEndpointInfo()).thenReturn(false);
    const [plugin, spyPlugin] = getPlugins();

    await plugin.execute("execute", mockConnectFunc, []);
    expect(connectCounter).toBe(1);
    verify(spyPlugin.createMonitorIfAbsent(anything())).never();
  });

  it("testExecute_monitorCreated", async () => {
    when(mockMonitor.hasCustomEndpointInfo()).thenReturn(true);
    const [plugin, spyPlugin] = getPlugins();

    await plugin.connect(host, props, true, mockConnectFunc);
    await plugin.execute("execute", mockExecuteFunc, []);
    expect(executeCounter).toBe(1);
    verify(spyPlugin.createMonitorIfAbsent(anything())).twice();
  });

  it("testCloseMonitors", async () => {
    TestCustomEndpointPlugin.getMonitors().computeIfAbsent("test-monitor", () => instance(mockMonitor), BigInt(30_000_000_000));
    TestCustomEndpointPlugin.closeMonitors();
    verify(mockMonitor.close()).atLeast(1);
  });
});
