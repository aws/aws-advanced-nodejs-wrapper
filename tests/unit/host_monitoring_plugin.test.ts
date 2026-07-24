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
import { HostMonitoringConnectionPlugin } from "../../common/lib/plugins/efm/v1/host_monitoring_connection_plugin";
import { anything, instance, mock, reset, verify, when } from "ts-mockito";
import { HostMonitorServiceImpl } from "../../common/lib/plugins/efm/base/host_monitor_service";
import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { ConnectionContext, ConnectionContextImpl } from "../../common/lib/plugins/efm/base/connection_context";
import { AwsWrapperError, HostInfo } from "../../common/lib";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { HostChangeOptions } from "../../common/lib/host_change_options";
import { OldConnectionSuggestionAction } from "../../common/lib/old_connection_suggestion_action";
import { Messages } from "../../common/lib/utils/messages";
import { AwsPGClient } from "../../pg/lib";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { FullServicesContainer } from "../../common/lib/utils/full_services_container";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";

const FAILURE_DETECTION_TIME = 10;
const FAILURE_DETECTION_INTERVAL = 100;
const FAILURE_DETECTION_COUNT = 5;
const MONITOR_METHOD_NAME = "query";
const NO_MONITOR_METHOD_NAME = "end";

const mockMonitorService: HostMonitorServiceImpl = mock(HostMonitorServiceImpl);
const mockConnectionContext: ConnectionContextImpl = mock(ConnectionContextImpl);
const mockPluginService: PluginServiceImpl = mock(PluginServiceImpl);
const mockClient: AwsPGClient = mock(AwsPGClient);
const mockHostInfo1 = mock(HostInfo);
const mockHostInfo2 = mock(HostInfo);

const properties: Map<string, any> = new Map();
let plugin: HostMonitoringConnectionPlugin;

let queryCounter = 0;
function incrementQueryCounter() {
  queryCounter++;
  return Promise.resolve();
}

const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

function initDefaultMockReturns() {
  when(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything())).thenResolve(
    instance(mockConnectionContext)
  );
  when(mockConnectionContext.isActiveContext()).thenReturn(true);
  when(mockConnectionContext.isHostUnhealthy()).thenReturn(false);
  when(mockHostInfo1.host).thenReturn("host");
  when(mockHostInfo1.port).thenReturn(1234);
  when(mockHostInfo2.host).thenReturn("host");
  when(mockHostInfo2.port).thenReturn(1234);
  when(mockPluginService.getCurrentHostInfo()).thenReturn(instance(mockHostInfo1));
  when(mockPluginService.getRoutedHostInfo()).thenReturn(instance(mockHostInfo1));
  when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClient));
  when(mockClient.targetClient).thenReturn(mockClientWrapper);

  properties.set(WrapperProperties.FAILURE_DETECTION_ENABLED.name, true);
  properties.set(WrapperProperties.FAILURE_DETECTION_TIME_MS.name, FAILURE_DETECTION_TIME);
  properties.set(WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, FAILURE_DETECTION_INTERVAL);
  properties.set(WrapperProperties.FAILURE_DETECTION_COUNT.name, FAILURE_DETECTION_COUNT);
}

function initializePlugin() {
  const servicesContainer = {
    pluginService: instance(mockPluginService),
    telemetryFactory: new NullTelemetryFactory()
  } as unknown as FullServicesContainer;

  plugin = new HostMonitoringConnectionPlugin(servicesContainer, properties, instance(mockMonitorService));
}

describe("host monitoring plugin test", () => {
  beforeEach(() => {
    reset(mockMonitorService);
    reset(mockConnectionContext);
    reset(mockPluginService);
    reset(mockClient);

    initDefaultMockReturns();
    properties.clear();
    queryCounter = 0;
  });

  it("execute with monitoring disabled", async () => {
    properties.set(WrapperProperties.FAILURE_DETECTION_ENABLED.name, false);
    initializePlugin();
    await plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {});

    verify(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything())).never();
    verify(mockMonitorService.stopMonitoring(anything())).never();
    expect(queryCounter).toBe(1);
  });

  it("execute with no need to monitor", async () => {
    initializePlugin();
    await plugin.execute(NO_MONITOR_METHOD_NAME, incrementQueryCounter, {});

    verify(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything())).never();
    verify(mockMonitorService.stopMonitoring(anything())).never();
    expect(queryCounter).toBe(1);
  });

  it("execute with monitoring enabled", async () => {
    initializePlugin();
    await plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {});

    verify(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything())).once();
    verify(mockMonitorService.stopMonitoring(anything())).once();
    expect(queryCounter).toBe(1);
  });

  it("execute cleanup when checking connection status throws error", async () => {
    initializePlugin();

    const expectedError = new AwsWrapperError("Error thrown during isClientValid");
    when(mockConnectionContext.isHostUnhealthy()).thenReturn(true);
    when(mockPluginService.isClientValid(mockClientWrapper)).thenThrow(expectedError);
    await expect(plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {})).rejects.toThrow(expectedError);
  });

  it("execute cleanup when connection is invalid throws unavailable host error", async () => {
    initializePlugin();

    when(mockPluginService.isClientValid(mockClientWrapper)).thenResolve(false);
    when(mockConnectionContext.isHostUnhealthy()).thenReturn(true);

    const expectedError = new AwsWrapperError(Messages.get("HostMonitoringConnectionPlugin.unavailableHost", "host"));
    await expect(plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {})).rejects.toThrow(expectedError);
  });

  it("notify connection changed resets monitoring host info", async () => {
    initializePlugin();

    const result = await plugin.notifyConnectionChanged(new Set([HostChangeOptions.HOSTNAME]));
    expect(result).toBe(OldConnectionSuggestionAction.NO_OPINION);
  });
});
