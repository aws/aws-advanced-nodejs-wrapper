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

import {
  AuroraInitialConnectionStrategyPlugin
} from "../../common/lib/plugins/aurora_initial_connection_strategy_plugin";
import { PluginService } from "../../common/lib/plugin_service";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { HostRole } from "../../common/lib/host_role";
import { HostInfo } from "../../common/lib/host_info";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { jest } from "@jest/globals";
import { PgClientWrapper } from "../../common/lib/pg_client_wrapper";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";

const mockPluginService = mock(PluginService);
const mockHostListProviderService = mock<HostListProviderService>();
const mockRdsUtils = mock(RdsUtils);
const mockReaderHostInfo = mock(HostInfo);
const mockFunc = jest.fn(() => {
  return Promise.resolve(instance(mock(PgClientWrapper)));
});

const mockFuncUndefined = jest.fn(() => {
  return Promise.resolve(undefined);
});

const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const hostInfo = hostInfoBuilder.withHost("host").build();

const writerHostInfo = hostInfoBuilder.withHost("host").withRole(HostRole.WRITER).build();
const readerHostInfo = hostInfoBuilder.withHost("host").withHost(HostRole.READER).build();

describe("Aurora initial connection strategy plugin", () => {
  let props: Map<string, any>;
  let plugin: AuroraInitialConnectionStrategyPlugin;
  let writerClient: ClientWrapper;
  let readerClient: ClientWrapper;

  beforeEach(() => {
    props = new Map<string, any>();
    plugin = new AuroraInitialConnectionStrategyPlugin(instance(mockPluginService));
    plugin["rdsUtils"] = instance(mockRdsUtils);
    plugin.initHostProvider(hostInfo, props, instance(mockHostListProviderService), mockFunc);
    WrapperProperties.OPEN_CONNECTION_RETRY_TIMEOUT_MS.set(props, 1000);

    writerClient = new MySQLClientWrapper(undefined, writerHostInfo, new Map<string, any>(), new MySQL2DriverDialect());
    readerClient = new MySQLClientWrapper(undefined, readerHostInfo, new Map<string, any>(), new MySQL2DriverDialect());
  });

  afterEach(() => {
    reset(mockRdsUtils);
    reset(mockPluginService);
    reset(mockHostListProviderService);
    reset(mockReaderHostInfo);
  });

  it("test non rds cluster", async () => {
    const spyPlugin = spy(new AuroraInitialConnectionStrategyPlugin(instance(mockPluginService)));
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_INSTANCE);

    await spyPlugin.connect(hostInfo, props, true, mockFunc);
    verify(spyPlugin.getVerifiedReaderClient(props, true, mockFunc)).never();
    verify(spyPlugin.getVerifiedWriterClient(props, true, mockFunc)).never();
  });

  it("test invalid reader strategy", async () => {
    WrapperProperties.READER_HOST_SELECTOR_STRATEGY.set(props, "invalidStrategy");
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);

    await expect(plugin.connect(hostInfo, props, true, mockFunc)).rejects.toThrow(Error);
  });

  it("test static HostListProvider", async () => {
    const plugin = new AuroraInitialConnectionStrategyPlugin(instance(mockPluginService));
    when(mockHostListProviderService.isStaticHostListProvider()).thenReturn(true);

    expect(() => {
      plugin.initHostProvider(hostInfo, props, instance(mockHostListProviderService), mockFunc);
    }).toThrow(AwsWrapperError);
  });

  it("test writer - not found", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);
    when(mockPluginService.getAllHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()]);
    expect(await plugin.connect(hostInfo, props, true, mockFuncUndefined)).toBe(undefined);
  });

  it("test writer - resolves to reader", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);
    when(mockPluginService.getAllHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenResolve(instance(readerClient));

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(undefined);
  });

  it("test writer - resolve to writer", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);
    when(mockPluginService.getAllHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.getHostRole(writerClient)).thenReturn(Promise.resolve(HostRole.WRITER));
    when(mockPluginService.connect(anything(), anything())).thenResolve(writerClient);

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(writerClient);
    verify(mockPluginService.forceRefreshHostList(writerClient)).never();
  });

  it("test reader - not found", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    expect(await plugin.connect(hostInfo, props, true, mockFuncUndefined)).toBe(undefined);
  });

  it("test reader - resolves to reader", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenResolve(readerClient);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    when(mockPluginService.getHostRole(readerClient)).thenReturn(Promise.resolve(HostRole.READER));
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(instance(mockReaderHostInfo));

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(readerClient);
    verify(mockPluginService.forceRefreshHostList(readerClient)).never();
  });

  it("test reader - resolves to writer", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenResolve(writerClient);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);

    expect(await plugin.connect(hostInfo, props, true, mockFuncUndefined)).toBe(undefined);
  });

  it("test reader - return writer", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getAllHosts())
      .thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()])
      .thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenResolve(writerClient);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    when(mockPluginService.getHostRole(writerClient)).thenReturn(Promise.resolve(HostRole.WRITER));
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(instance(mockReaderHostInfo));

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(writerClient);
  });
});
