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
import { HostInfo } from "../../common/lib/host_info";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { HostRole } from "../../common/lib/host_role";
import { PluginService } from "../../common/lib/plugin_service";
import { AwsWrapperError, FailoverSuccessError } from "../../common/lib/utils/errors";
import { AwsMySQLClient } from "../../mysql/lib";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { ReadWriteSplittingPlugin } from "../../common/lib/plugins/read_write_splitting_plugin";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { MySQLDatabaseDialect } from "../../mysql/lib/dialect/mysql_database_dialect";
import { HostChangeOptions } from "../../common/lib/host_change_options";
import { OldConnectionSuggestionAction } from "../../common/lib/old_connection_suggestion_action";
import { HostListProvider } from "../../common/lib/host_list_provider/host_list_provider";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { InternalPooledConnectionProvider } from "../../common/lib/internal_pooled_connection_provider";
import { AwsPoolConfig } from "../../common/lib/aws_pool_config";
import { ConnectionProviderManager } from "../../common/lib/connection_provider_manager";
import { InternalPoolMapping } from "../../common/lib/utils/internal_pool_mapping";
import { DriverDialect } from "../../common/lib/driver_dialect/driver_dialect";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { PgClientWrapper } from "../../common/lib/pg_client_wrapper";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { PoolClientWrapper } from "../../common/lib/pool_client_wrapper";
import { jest } from "@jest/globals";

const properties: Map<string, any> = new Map();
const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const writerHost = builder.withHost("writer-host").withRole(HostRole.WRITER).build();
const writerHostUnknownRole = builder.withHost("writer-host").withRole(HostRole.UNKNOWN).build();
const readerHostIncorrectRole = builder.withHost("instance1").withRole(HostRole.WRITER).build();
const readerHost1 = builder.withHost("instance1").withRole(HostRole.READER).build();
const readerHost2 = builder.withHost("instance2").withRole(HostRole.READER).build();

const defaultHosts = [writerHost, readerHost1, readerHost2];
const singleReaderTopology = [writerHost, readerHost1];
const mockPluginService: PluginService = mock(PluginService);
const mockReaderClient: AwsClient = mock(AwsMySQLClient);
const mockWriterClient: AwsClient = mock(AwsMySQLClient);
const mockNewWriterClient: AwsClient = mock(AwsMySQLClient);
const mockMySQLClient: AwsClient = mock(AwsMySQLClient);
const mockHostInfo: HostInfo = mock(HostInfo);
const mockHostListProviderService: HostListProviderService = mock<HostListProviderService>();
const mockHostListProvider: HostListProvider = mock<HostListProvider>();
const mockClosedReaderClient: AwsClient = mock(AwsMySQLClient);
const mockClosedWriterClient: AwsClient = mock(AwsMySQLClient);
const mockDialect: MySQLDatabaseDialect = mock(MySQLDatabaseDialect);
const mockDriverDialect: DriverDialect = mock(MySQL2DriverDialect);
const mockChanges: Set<HostChangeOptions> = mock(Set<HostChangeOptions>);

const mockReaderWrapper: ClientWrapper = mock(PgClientWrapper);
const mockWriterWrapper: ClientWrapper = mock(MySQLClientWrapper);
const poolClientWrapper: ClientWrapper = new PoolClientWrapper(undefined, writerHost, new Map<string, string>());

const clientWrapper_undefined: any = undefined;

const mockConnectFunc = jest.fn(() => {
  return Promise.resolve(mockReaderWrapper);
});

const mockExecuteFuncThrowsFailoverSuccessError = jest.fn(() => {
  throw new FailoverSuccessError("test");
});

describe("reader write splitting test", () => {
  beforeEach(() => {
    when(mockPluginService.getHostListProvider()).thenReturn(instance(mockHostListProvider));
    when(mockPluginService.getAllHosts()).thenReturn(defaultHosts);
    when(mockPluginService.getHosts()).thenReturn(defaultHosts);
    when(mockPluginService.isInTransaction()).thenReturn(false);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockPluginService.getDriverDialect()).thenReturn(mockDriverDialect);
    when(mockDriverDialect.connect(anything(), anything())).thenReturn(Promise.resolve(mockReaderWrapper));
    properties.clear();
  });

  afterEach(() => {
    reset(mockReaderClient);
    reset(mockMySQLClient);
    reset(mockHostInfo);
    reset(mockPluginService);
    reset(mockHostListProviderService);
    reset(mockReaderClient);
    reset(mockWriterClient);
    reset(mockClosedReaderClient);
    reset(mockClosedWriterClient);
  });

  it("test set read only true", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    when(mockPluginService.getAllHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.connect(anything(), anything())).thenResolve(mockReaderWrapper);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      clientWrapper_undefined,
      clientWrapper_undefined
    );

    await target.switchClientIfRequired(true);
    verify(mockPluginService.refreshHostList()).once();
    verify(mockPluginService.setCurrentClient(mockReaderWrapper, readerHost1)).once();
    expect(target.readerTargetClient).toBe(mockReaderWrapper);
  });

  it("test set read only false", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getAllHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(writerHost);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockReaderClient));
    when(await mockReaderClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerHost1);
    when(mockPluginService.connect(anything(), anything())).thenResolve(mockWriterWrapper);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      mockWriterWrapper,
      clientWrapper_undefined
    );

    await target.switchClientIfRequired(false);
    verify(mockPluginService.setCurrentClient(mockWriterWrapper, writerHost)).once();
    expect(target.writerTargetClient).toEqual(mockWriterWrapper);
  });

  it("test set read only true already on reader", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    when(mockPluginService.getAllHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockReaderClient));
    when(await mockReaderClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerHost1);
    when(mockPluginService.connect(anything(), anything())).thenResolve(mockReaderWrapper);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderServiceInstance,
      clientWrapper_undefined,
      mockReaderWrapper
    );

    await target.switchClientIfRequired(true);
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.readerTargetClient).toEqual(mockReaderWrapper);
    expect(target.writerTargetClient).toEqual(undefined);
  });

  it("test set read only false already on reader", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);
    when(mockPluginService.getAllHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.connect(anything(), anything())).thenResolve(mockReaderWrapper);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderServiceInstance,
      mockWriterWrapper,
      clientWrapper_undefined
    );

    await target.switchClientIfRequired(false);
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.writerTargetClient).toEqual(mockWriterWrapper);
    expect(target.readerTargetClient).toEqual(undefined);
  });

  it("test set read only true one host", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn([writerHost]);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(writerHost);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockWriterClient.targetClient).thenReturn(mockWriterWrapper);
    when(mockWriterClient.targetClient && (await mockPluginService.isClientValid(mockWriterClient.targetClient))).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.connect(anything(), anything())).thenReturn(Promise.resolve(mockWriterWrapper));

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      mockWriterWrapper,
      clientWrapper_undefined
    );

    await target.switchClientIfRequired(true);

    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.readerTargetClient).toEqual(undefined);
    expect(target.writerTargetClient).toEqual(mockWriterWrapper);
  });

  it("test connect incorrect host role", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);
    const mockHostListProviderInstance = instance(mockHostListProvider);

    when(mockPluginService.getCurrentClient()).thenReturn(mockReaderClient);
    when(mockPluginService.getInitialConnectionHostInfo()).thenReturn(readerHostIncorrectRole);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerHost1);

    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    when(mockHostListProviderService.isStaticHostListProvider()).thenReturn(false);
    when(mockHostListProviderService.getHostListProvider()).thenReturn(mockHostListProviderInstance);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderServiceInstance,
      clientWrapper_undefined,
      clientWrapper_undefined
    );

    await target.connect(writerHost, properties, true, mockConnectFunc);
    verify(mockHostListProviderService.setInitialConnectionHostInfo(anything())).once();
    expect(mockConnectFunc).toHaveBeenCalled();
  });

  it("test set read only false writer connection failed", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getAllHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockReaderClient));
    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerHost1);
    when(await mockPluginService.connect(writerHost, properties)).thenReject();

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      clientWrapper_undefined,
      mockReaderWrapper
    );

    await expect(async () => await target.switchClientIfRequired(false)).rejects.toThrow(AwsWrapperError);
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
  });

  it("test set read only true reader connection failed", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    when(mockPluginService.getHosts()).thenReturn(defaultHosts);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.connect(readerHost1 || readerHost2, properties)).thenReject();

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderServiceInstance,
      mockWriterWrapper,
      clientWrapper_undefined
    );

    await target.switchClientIfRequired(true);
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.readerTargetClient).toEqual(undefined);
  });

  it("test set read only on closed connection", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(writerHost);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClosedWriterClient));
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      mockWriterWrapper,
      clientWrapper_undefined
    );

    await expect(async () => await target.switchClientIfRequired(true)).rejects.toThrow(AwsWrapperError);
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.readerTargetClient).toEqual(undefined);
  });

  it("test execute failover to new writer", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    properties.set(WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.name, true);

    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(writerHost);
    when(mockPluginService.getCurrentClient()).thenReturn(mockNewWriterClient);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(await mockPluginService.isClientValid(mockWriterWrapper)).thenReturn(true);
    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      mockWriterWrapper,
      clientWrapper_undefined
    );

    await expect(async () => {
      await target.execute("query", mockExecuteFuncThrowsFailoverSuccessError, "test");
    }).rejects.toThrow(new FailoverSuccessError("test"));

    verify(mockPluginService.abortTargetClient(mockWriterWrapper)).once();
  });

  it("test notify connection changed", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn(defaultHosts);
    when(mockPluginService.getCurrentClient()).thenReturn(mockWriterClient);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      clientWrapper_undefined,
      clientWrapper_undefined
    );

    const suggestion = await target.notifyConnectionChanged(mockChanges);
    expect(suggestion).toEqual(OldConnectionSuggestionAction.NO_OPINION);
  });

  it("test notify non initial connection", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getCurrentClient()).thenReturn(mockWriterClient);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderService,
      mockWriterWrapper,
      clientWrapper_undefined
    );

    await target.connect(writerHost, properties, false, mockConnectFunc);

    expect(mockConnectFunc).toHaveBeenCalled();
    verify(mockHostListProviderService.getInitialConnectionHostInfo()).never();
  });

  it("test connect error updating host", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHostUnknownRole);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);
    when(mockHostListProviderService.isStaticHostListProvider()).thenReturn(false);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderServiceInstance,
      clientWrapper_undefined,
      clientWrapper_undefined
    );

    await expect(async () => await target.connect(writerHost, properties, true, mockConnectFunc)).rejects.toThrow(AwsWrapperError);
    verify(mockHostListProviderService.setInitialConnectionHostInfo(anything())).never();
  });

  it("test pooled reader connection after set read only", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost).thenReturn(writerHost).thenReturn(readerHost1);
    when(mockDriverDialect.connect(anything(), anything())).thenReturn(Promise.resolve(poolClientWrapper));
    when(mockPluginService.connect(anything(), anything())).thenResolve(poolClientWrapper);
    const config: AwsPoolConfig = new AwsPoolConfig({
      idleTimeoutMillis: 7000,
      maxConnections: 10,
      maxIdleConnections: 10
    });
    const provider: InternalPooledConnectionProvider = new InternalPooledConnectionProvider(config);

    properties["connectionProvider"] = provider;

    const target: ReadWriteSplittingPlugin = spy(
      new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, mockWriterWrapper, clientWrapper_undefined)
    );

    const spyTarget = instance(target);
    await spyTarget.switchClientIfRequired(true);
    await spyTarget.switchClientIfRequired(false);
    verify(target.closeTargetClientIfIdle(poolClientWrapper)).once();
  });

  it("test pooled writer connection after set read only", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(HostRole.READER, "random")).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo())
      .thenReturn(writerHost)
      .thenReturn(writerHost)
      .thenReturn(readerHost1)
      .thenReturn(readerHost1)
      .thenReturn(writerHost);
    when(mockDriverDialect.connect(anything(), anything())).thenReturn(Promise.resolve(poolClientWrapper));
    when(mockPluginService.connect(writerHost, anything())).thenResolve(poolClientWrapper);
    when(mockPluginService.connect(readerHost1, anything())).thenResolve(poolClientWrapper);
    when(mockPluginService.connect(readerHost2, anything())).thenResolve(poolClientWrapper);

    const config: AwsPoolConfig = new AwsPoolConfig({
      idleTimeoutMillis: 7000,
      maxConnections: 10,
      maxIdleConnections: 10
    });
    const myKeyFunc: InternalPoolMapping = {
      getPoolKey: (hostInfo: HostInfo, props: Map<string, any>) => {
        return hostInfo.url + "someKey";
      }
    };
    const provider: InternalPooledConnectionProvider = new InternalPooledConnectionProvider(config, myKeyFunc);

    properties["connectionProvider"] = provider;

    const target: ReadWriteSplittingPlugin = spy(
      new ReadWriteSplittingPlugin(
        mockPluginServiceInstance,
        properties,
        mockHostListProviderService,
        clientWrapper_undefined,
        clientWrapper_undefined
      )
    );

    const spyTarget = instance(target);
    await spyTarget.switchClientIfRequired(true);
    await spyTarget.switchClientIfRequired(false);
    await spyTarget.switchClientIfRequired(true);

    verify(target.closeTargetClientIfIdle(poolClientWrapper)).twice();
  });
});
