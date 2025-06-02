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
import { HostMonitoringConnectionPlugin } from "../../common/lib/plugins/efm/host_monitoring_connection_plugin";
import { DatabaseDialect } from "../../common/lib/database_dialect/database_dialect";
import { PgDatabaseDialect } from "../../pg/lib/dialect/pg_database_dialect";
import { anything, instance, mock, reset, verify, when } from "ts-mockito";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { MonitorServiceImpl } from "../../common/lib/plugins/efm/monitor_service";
import { PluginService } from "../../common/lib/plugin_service";
import { MonitorConnectionContext } from "../../common/lib/plugins/efm/monitor_connection_context";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { HostInfo } from "../../common/lib/host_info";
import { HostChangeOptions } from "../../common/lib/host_change_options";
import { OldConnectionSuggestionAction } from "../../common/lib/old_connection_suggestion_action";
import { HostAvailability } from "../../common/lib/host_availability/host_availability";
import { Messages } from "../../common/lib/utils/messages";
import { AwsPGClient } from "../../pg/lib";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";

const FAILURE_DETECTION_TIME = 10;
const FAILURE_DETECTION_INTERVAL = 100;
const FAILURE_DETECTION_COUNT = 5;
const MONITOR_METHOD_NAME = "query";
const NO_MONITOR_METHOD_NAME = "end";

const mockDialect: DatabaseDialect = mock(PgDatabaseDialect);
const mockMonitorService: MonitorServiceImpl = mock(MonitorServiceImpl);
const mockMonitorConnectionContext: MonitorConnectionContext = mock(MonitorConnectionContext);
const mockPluginService: PluginService = mock(PluginService);
const mockClient: AwsPGClient = mock(AwsPGClient);
const mockRdsUtils = mock(RdsUtils);
const mockHostInfo1 = mock(HostInfo);
const mockHostInfo2 = mock(HostInfo);

const properties: Map<string, any> = new Map();
let plugin: HostMonitoringConnectionPlugin;

let queryCounter = 0;
function incrementQueryCounter() {
  queryCounter++;
  return Promise.resolve();
}

const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>());

function initDefaultMockReturns() {
  when(mockDialect.getHostAliasQuery()).thenReturn("any");
  when(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything(), anything())).thenResolve(
    instance(mockMonitorConnectionContext)
  );
  when(mockHostInfo1.host).thenReturn("host");
  when(mockHostInfo1.port).thenReturn(1234);
  when(mockHostInfo2.host).thenReturn("host");
  when(mockHostInfo2.port).thenReturn(1234);
  when(mockPluginService.getCurrentHostInfo()).thenReturn(instance(mockHostInfo1));
  when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClient));
  when(mockClient.targetClient).thenReturn(mockClientWrapper);
  when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_INSTANCE);

  properties.set(WrapperProperties.FAILURE_DETECTION_ENABLED.name, true);
  properties.set(WrapperProperties.FAILURE_DETECTION_TIME_MS.name, FAILURE_DETECTION_TIME);
  properties.set(WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name, FAILURE_DETECTION_INTERVAL);
  properties.set(WrapperProperties.FAILURE_DETECTION_COUNT.name, FAILURE_DETECTION_COUNT);
}

function initializePlugin() {
  plugin = new HostMonitoringConnectionPlugin(instance(mockPluginService), properties, instance(mockRdsUtils), instance(mockMonitorService));
}

describe("host monitoring plugin test", () => {
  beforeEach(() => {
    reset(mockMonitorService);
    reset(mockMonitorConnectionContext);
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

    verify(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything(), anything())).never();
    verify(mockMonitorService.stopMonitoring(anything())).never();
    expect(queryCounter).toBe(1);
  });

  it("execute with no need to monitor", async () => {
    initializePlugin();
    await plugin.execute(NO_MONITOR_METHOD_NAME, incrementQueryCounter, {});

    verify(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything(), anything())).never();
    verify(mockMonitorService.stopMonitoring(anything())).never();
    expect(queryCounter).toBe(1);
  });

  it("execute with monitoring enabled", async () => {
    initializePlugin();
    await plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {});

    verify(mockMonitorService.startMonitoring(anything(), anything(), anything(), anything(), anything(), anything(), anything())).once();
    verify(mockMonitorService.stopMonitoring(anything())).once();
    expect(queryCounter).toBe(1);
  });

  it("execute cleanup when checking connection status throws error", async () => {
    initializePlugin();

    const expectedError = new AwsWrapperError("Error thrown during isClientValid");
    when(mockMonitorConnectionContext.isHostUnhealthy).thenReturn(true);
    when(mockPluginService.isClientValid(mockClientWrapper)).thenThrow(expectedError);
    await expect(plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {})).rejects.toThrow(expectedError);
  });

  it("execute cleanup when abort connection throws error", async () => {
    initializePlugin();

    when(mockPluginService.isClientValid(mockClientWrapper)).thenResolve(false);
    when(mockMonitorConnectionContext.isHostUnhealthy).thenReturn(true);

    const expectedError = new AwsWrapperError(Messages.get("HostMonitoringConnectionPlugin.unavailableHost", "host"));
    await expect(plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {})).rejects.toThrow(expectedError);
    verify(mockPluginService.setAvailability(anything(), HostAvailability.NOT_AVAILABLE)).once();
  });

  it("test connect", async () => {
    initializePlugin();
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);

    await plugin.connect(instance(mockHostInfo1), properties, true, () => {
      return Promise.resolve(mockClientWrapper);
    });
    verify(mockPluginService.fillAliases(anything(), anything())).once();
  });

  it.each([[HostChangeOptions.WENT_DOWN], [HostChangeOptions.HOST_DELETED]])(
    "notify connection changed when node went down",
    async (options: HostChangeOptions) => {
      initializePlugin();

      await plugin.execute(MONITOR_METHOD_NAME, incrementQueryCounter, {});

      const aliases1 = new Set(["alias1", "alias2"]);
      const aliases2 = new Set(["alias3", "alias4"]);

      when(mockHostInfo1.allAliases).thenReturn(aliases1);
      when(mockHostInfo2.allAliases).thenReturn(aliases2);
      when(mockPluginService.getCurrentHostInfo()).thenReturn(instance(mockHostInfo1));

      expect(await plugin.notifyConnectionChanged(new Set([options]))).toBe(OldConnectionSuggestionAction.NO_OPINION);
      // NodeKeys should contain {"alias1", "alias2"}.
      verify(mockMonitorService.stopMonitoringForAllConnections(aliases1)).once();

      when(mockPluginService.getCurrentHostInfo()).thenReturn(instance(mockHostInfo2));
      expect(await plugin.notifyConnectionChanged(new Set([options]))).toBe(OldConnectionSuggestionAction.NO_OPINION);
      // NotifyConnectionChanged should reset the monitoringHostSpec.
      // NodeKeys should contain {"alias3", "alias4"}
      verify(mockMonitorService.stopMonitoringForAllConnections(aliases2)).once();
    }
  );
});
