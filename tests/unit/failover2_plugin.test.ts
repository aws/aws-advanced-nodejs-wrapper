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

import { AwsClient } from "../../common/lib/aws_client";
import { HostAvailability } from "../../common/lib/host_availability/host_availability";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { HostInfo } from "../../common/lib/host_info";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { RdsHostListProvider } from "../../common/lib/host_list_provider/rds_host_list_provider";
import { HostRole } from "../../common/lib/host_role";
import { PluginService } from "../../common/lib/plugin_service";
import { FailoverMode } from "../../common/lib/plugins/failover/failover_mode";
import { AwsWrapperError, FailoverFailedError, FailoverSuccessError, TransactionResolutionUnknownError } from "../../common/lib/utils/errors";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { AwsMySQLClient } from "../../mysql/lib";
import { anything, instance, mock, reset, resetCalls, spy, verify, when } from "ts-mockito";
import { Messages } from "../../common/lib/utils/messages";
import { HostChangeOptions } from "../../common/lib/host_change_options";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { DriverDialect } from "../../common/lib/driver_dialect/driver_dialect";
import { Failover2Plugin } from "../../common/lib/plugins/failover2/failover2_plugin";

const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });

const mockPluginService: PluginService = mock(PluginService);
const mockAwsClient: AwsClient = mock(AwsClient);
const mockMySQLClient: AwsClient = mock(AwsMySQLClient);
const mockHostInfo: HostInfo = mock(HostInfo);
const mockRdsHostListProvider: RdsHostListProvider = mock(RdsHostListProvider);
const mockDriverDialect: DriverDialect = mock(MySQL2DriverDialect);

const mockClientWrapper = new MySQLClientWrapper(undefined, mockHostInfo, new Map<string, any>(), mockDriverDialect);

const properties: Map<string, any> = new Map();

let plugin: Failover2Plugin;

function initializePlugin(mockPluginServiceInstance: PluginService): void {
  plugin = new Failover2Plugin(mockPluginServiceInstance, properties, new RdsUtils());
}

describe("reader failover handler", () => {
  beforeEach(() => {
    when(mockRdsHostListProvider.getRdsUrlType()).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);
    when(mockPluginService.getHostListProvider()).thenReturn(instance(mockRdsHostListProvider));
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockAwsClient));
    when(mockPluginService.abortCurrentClient()).thenResolve();
    when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());
    properties.clear();
  });

  afterEach(() => {
    reset(mockAwsClient);
    reset(mockMySQLClient);
    reset(mockHostInfo);
    reset(mockPluginService);
    reset(mockRdsHostListProvider);
  });

  it("test notify list changed with failover disabled", async () => {
    properties.set(WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.name, false);
    const changes: Map<string, Set<HostChangeOptions>> = new Map();

    initializePlugin(instance(mockPluginService));
    await plugin.notifyHostListChanged(changes);

    verify(mockPluginService.getCurrentHostInfo()).never();
  });

  it("test notify list changed with valid connection not in topology", async () => {
    const changes: Map<string, Set<HostChangeOptions>> = new Map();
    changes.set("cluster-host/", new Set<HostChangeOptions>([HostChangeOptions.HOST_DELETED]));
    changes.set("instance/", new Set<HostChangeOptions>([HostChangeOptions.HOST_ADDED]));

    initializePlugin(instance(mockPluginService));
    await plugin.notifyHostListChanged(changes);

    when(mockHostInfo.url).thenReturn("cluster-url/");
    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["instance"]));

    verify(mockPluginService.getCurrentHostInfo()).once();
    verify(mockHostInfo.allAliases).never();
  });

  it("test update topology", async () => {
    when(mockAwsClient.isValid()).thenResolve(true);

    // Test updateTopology with failover disabled
    WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.set(properties, false);
    initializePlugin(instance(mockPluginService));
    await plugin.updateTopology(false);
    verify(mockPluginService.forceRefreshHostList()).never();
    verify(mockPluginService.refreshHostList()).never();

    // Test updateTopology with no connection
    WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.set(properties, true);
    initializePlugin(instance(mockPluginService));
    when(mockPluginService.getCurrentHostInfo()).thenReturn(null);
    await plugin.updateTopology(false);
    verify(mockPluginService.forceRefreshHostList()).never();
    verify(mockPluginService.refreshHostList()).never();

    // Test updateTopology with closed connection
    when(mockAwsClient.isValid()).thenResolve(true);
    await plugin.updateTopology(false);
    verify(mockPluginService.forceRefreshHostList()).never();
    verify(mockPluginService.refreshHostList()).never();

    // Test with hosts
    when(mockPluginService.getHosts()).thenReturn([builder.withHost("host").build()]);

    // Test updateTopology with forceUpdate == true
    await plugin.updateTopology(true);
    verify(mockPluginService.forceRefreshHostList()).once();
    verify(mockPluginService.refreshHostList()).never();
    resetCalls(mockPluginService);

    // Test updateTopology with forceUpdate == false
    await plugin.updateTopology(false);
    verify(mockPluginService.forceRefreshHostList()).never();
    verify(mockPluginService.refreshHostList()).once();
  });

  it("test failover - failover reader", async () => {
    when(mockPluginService.isInTransaction()).thenReturn(true);
    initializePlugin(instance(mockPluginService));

    const spyPlugin: Failover2Plugin = spy(plugin);
    when(spyPlugin.failoverWriter()).thenResolve();
    plugin.failoverMode = FailoverMode.STRICT_WRITER;

    await expect(plugin.failover(instance(mockHostInfo))).rejects.toThrow(
      new TransactionResolutionUnknownError(Messages.get("Failover.transactionResolutionUnknownError"))
    );

    verify(spyPlugin.failoverWriter()).once();
  });

  it("test failover - failover writer", async () => {
    when(mockPluginService.isInTransaction()).thenReturn(false);
    initializePlugin(instance(mockPluginService));

    const mockHostInfoInstance: HostInfo = instance(mockHostInfo);
    const spyPlugin: Failover2Plugin = spy(plugin);
    when(spyPlugin.failoverReader()).thenResolve();
    plugin.failoverMode = FailoverMode.READER_OR_WRITER;

    await expect(plugin.failover(mockHostInfoInstance)).rejects.toThrow(new FailoverSuccessError(Messages.get("Failover.connectionChangedError")));

    verify(spyPlugin.failoverReader()).once();
  });

  it("test failover reader success", async () => {
    // TODO
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "alias2"]));
    when(mockHostInfo.getRawAvailability()).thenReturn(HostAvailability.AVAILABLE);
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.initiateTopologyUpdate(false, anything())).thenResolve(true);
    when(mockPluginService.connect(hostInfo, anything())).thenResolve(mockClientWrapper);
    when(mockPluginService.getHostRole(mockClientWrapper)).thenResolve(HostRole.READER);

    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostInfoInstance = instance(mockHostInfo);

    initializePlugin(mockPluginServiceInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    const spyPlugin: Failover2Plugin = spy(plugin);
    when(spyPlugin.updateTopology(false)).thenReturn();

    await plugin.failoverReader();

    verify(mockPluginService.setCurrentClient(mockClientWrapper, hostInfo)).once();
  });

  it("test failover reader - connection throws error", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];
    const test = new AwsWrapperError("test");

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "alias2"]));
    when(mockHostInfo.getRawAvailability()).thenReturn(HostAvailability.AVAILABLE);
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.initiateTopologyUpdate(true, anything())).thenResolve(true);
    when(mockPluginService.connect(mockHostInfo, anything())).thenReject(test);

    const mockHostInfoInstance = instance(mockHostInfo);
    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    try {
      await plugin.failoverWriter();
      throw new Error("Expected a FailoverFailedError to be thrown");
    } catch (error) {
      if (!(error instanceof FailoverFailedError)) {
        throw new Error("Expected a FailoverFailedError to be thrown");
      }
    }
  });

  it("test failover writer failed - topology update throws error", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "alias2"]));
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.initiateTopologyUpdate(true, anything())).thenResolve(false);

    const mockHostInfoInstance = instance(mockHostInfo);
    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    try {
      await plugin.failoverWriter();
      throw new Error("Expected a FailoverFailedError to be thrown");
    } catch (error) {
      if (!(error instanceof FailoverFailedError)) {
        throw new Error("Expected a FailoverFailedError to be thrown");
      }
    }
  });

  it("test failover writer failed - failover with no result", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "alias2"]));
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.initiateTopologyUpdate(true, anything())).thenResolve(true);
    when(mockPluginService.connect(mockHostInfo, anything())).thenResolve(null);

    const mockHostInfoInstance = instance(mockHostInfo);
    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    try {
      await plugin.failoverWriter();
      throw new Error("Expected a FailoverFailedError to be thrown");
    } catch (error) {
      if (!(error instanceof FailoverFailedError)) {
        throw new Error("Expected a FailoverFailedError to be thrown");
      }
    }

    verify(mockPluginService.initiateTopologyUpdate(true, anything())).once();
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
  });

  it("test failover writer success", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "alias2"]));
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.initiateTopologyUpdate(true, anything())).thenResolve(true);
    when(mockPluginService.connect(hostInfo, anything())).thenResolve(mockClientWrapper);
    when(mockPluginService.getHostRole(mockClientWrapper)).thenResolve(HostRole.WRITER);

    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostInfoInstance = instance(mockHostInfo);

    initializePlugin(mockPluginServiceInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    await plugin.failoverWriter();

    verify(mockPluginService.initiateTopologyUpdate(true, anything())).once();
    verify(mockPluginService.setCurrentClient(mockClientWrapper, hostInfo)).once();
  });

  it("test invalid current connection - no connection", async () => {
    when(mockAwsClient.targetClient).thenReturn(undefined);
    const mockAwsClientInstance = instance(mockAwsClient);

    when(mockPluginService.getCurrentClient()).thenReturn(mockAwsClientInstance);
    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);
    await plugin.invalidateCurrentClient();

    verify(mockPluginService.getCurrentHostInfo()).never();
  });

  it("test invalidate current connection - in transaction", async () => {
    when(mockMySQLClient.targetClient).thenReturn(mockClientWrapper);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockMySQLClient));
    when(mockPluginService.isInTransaction()).thenReturn(true);
    when(mockHostInfo.host).thenReturn("host");
    when(mockHostInfo.port).thenReturn(123);
    when(mockHostInfo.role).thenReturn(HostRole.READER);

    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);
    await plugin.invalidateCurrentClient();
    verify(mockMySQLClient.rollback()).once();

    when(mockMySQLClient.rollback()).thenThrow(new AwsWrapperError());
    await plugin.invalidateCurrentClient();
  });

  it("test invalidate current connection - not in transaction", async () => {
    when(mockMySQLClient.targetClient).thenReturn(mockClientWrapper);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockMySQLClient));
    when(mockPluginService.isInTransaction()).thenReturn(false);
    when(mockHostInfo.host).thenReturn("host");
    when(mockHostInfo.port).thenReturn(123);
    when(mockHostInfo.role).thenReturn(HostRole.READER);

    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);
    await plugin.invalidateCurrentClient();

    verify(mockPluginService.isInTransaction()).once();
  });

  it("test invalidate current connection - with open connection", async () => {
    when(mockMySQLClient.targetClient).thenReturn(mockClientWrapper);
    when(mockMySQLClient.isValid()).thenResolve(false);
    const mockMySQLClientInstance = instance(mockMySQLClient);

    when(mockPluginService.getCurrentClient()).thenReturn(mockMySQLClientInstance);
    when(mockPluginService.isInTransaction()).thenReturn(false);

    when(mockHostInfo.host).thenReturn("host");
    when(mockHostInfo.port).thenReturn(123);
    when(mockHostInfo.role).thenReturn(HostRole.READER);

    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);

    await plugin.invalidateCurrentClient();

    when(mockPluginService.abortCurrentClient()).thenThrow(new Error("test"));

    await plugin.invalidateCurrentClient();

    verify(mockPluginService.abortCurrentClient()).twice();
  });

  it("test execute", async () => {
    properties.set(WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.name, false);
    let count = 0;
    const mockFunction = () => {
      count++;
      return Promise.resolve();
    };

    const mockPluginServiceInstance = instance(mockPluginService);
    initializePlugin(mockPluginServiceInstance);
    await plugin.execute("query", mockFunction);

    properties.set(WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.name, true);
    initializePlugin(mockPluginServiceInstance);
    await plugin.execute("end", mockFunction);

    expect(count).toStrictEqual(2);
    verify(mockRdsHostListProvider.getRdsUrlType()).never();
  });
});