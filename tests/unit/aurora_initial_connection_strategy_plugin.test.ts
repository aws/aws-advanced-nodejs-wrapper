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

import { AuroraInitialConnectionStrategyPlugin } from "../../common/lib/plugins/aurora_initial_connection_strategy_plugin";
import { PluginService } from "../../common/lib/plugin_service";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { HostRole } from "../../common/lib/host_role";
import { AwsClient } from "../../common/lib/aws_client";
import { HostInfo } from "../../common/lib/host_info";

const mockPluginService = mock(PluginService);
const mockHostListProviderService = mock<HostListProviderService>();
const mockRdsUtils = mock(RdsUtils);
const mockWriterClient = mock(AwsClient);
const mockReaderClient = mock(AwsClient);
const mockReaderHostInfo = mock(HostInfo);
const mockFunc = jest.fn();

const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const hostInfo = hostInfoBuilder.withHost("host").build();

describe("Aurora initial connection strategy plugin", () => {
  let props: Map<string, any>;
  let plugin: AuroraInitialConnectionStrategyPlugin;

  beforeEach(() => {
    props = new Map<string, any>();
    plugin = new AuroraInitialConnectionStrategyPlugin(instance(mockPluginService));
    plugin["rdsUtils"] = instance(mockRdsUtils);
    plugin.initHostProvider(hostInfo, props, instance(mockHostListProviderService), mockFunc);
    WrapperProperties.OPEN_CONNECTION_RETRY_TIMEOUT_MS.set(props, 1000);
  });

  afterEach(() => {
    reset(mockRdsUtils);
    reset(mockPluginService);
    reset(mockHostListProviderService);
    reset(mockWriterClient);
    reset(mockReaderClient);
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
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()]);
    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(undefined);
  });

  it("test writer - resolves to reader", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenReturn(instance(mockReaderClient));

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(undefined);
  });

  it("test writer - resolve to writer", async () => {
    const mockWriterClientInstance = instance(mockWriterClient);

    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.getHostRole(mockWriterClientInstance)).thenReturn(Promise.resolve(HostRole.WRITER));
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockWriterClientInstance);

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(mockWriterClientInstance);
    verify(mockPluginService.forceRefreshHostList(mockWriterClientInstance)).never();
  });

  it("test reader - not found", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(undefined);
  });

  it("test reader - resolves to reader", async () => {
    const mockReaderClientInstance = instance(mockReaderClient);
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockReaderClientInstance);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    when(mockPluginService.getHostRole(mockReaderClientInstance)).thenReturn(Promise.resolve(HostRole.READER));
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(instance(mockReaderHostInfo));

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(mockReaderClientInstance);
    verify(mockPluginService.forceRefreshHostList(mockReaderClientInstance)).never();
  });

  it("test reader - resolves to writer", async () => {
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getHosts()).thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenReturn(instance(mockWriterClient));
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(undefined);
  });

  it("test reader - return writer", async () => {
    const mockWriterClientInstance = instance(mockWriterClient);

    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_READER_CLUSTER);
    when(mockPluginService.getHosts())
      .thenReturn([hostInfoBuilder.withRole(HostRole.READER).build()])
      .thenReturn([hostInfoBuilder.withRole(HostRole.WRITER).build()]);
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockWriterClientInstance);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    when(mockPluginService.getHostRole(mockWriterClientInstance)).thenReturn(Promise.resolve(HostRole.WRITER));
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(instance(mockReaderHostInfo));

    expect(await plugin.connect(hostInfo, props, true, mockFunc)).toBe(mockWriterClientInstance);
  });
});