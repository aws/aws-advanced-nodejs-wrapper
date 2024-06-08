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

import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";
import { HostInfo } from "aws-wrapper-common-lib/lib/host_info";
import { HostInfoBuilder } from "aws-wrapper-common-lib/lib/host_info_builder";
import { HostRole } from "aws-wrapper-common-lib/lib/host_role";
import { PluginService } from "aws-wrapper-common-lib/lib/plugin_service";
import { AwsWrapperError, FailoverSuccessError } from "aws-wrapper-common-lib/lib/utils/errors";
import { AwsMySQLClient } from "../../mysql";
import { anything, instance, mock, reset, verify, when } from "ts-mockito";
import { HostListProviderService } from "aws-wrapper-common-lib/lib/host_list_provider_service";
import { ReadWriteSplittingPlugin } from "aws-wrapper-common-lib/lib/plugins/read_write_splitting";
import { SimpleHostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/simple_host_availability_strategy";
import { MySQLDatabaseDialect } from "mysql-wrapper/lib/dialect/mysql_database_dialect";
import { HostChangeOptions } from "aws-wrapper-common-lib/lib/host_change_options";
import { OldConnectionSuggestionAction } from "aws-wrapper-common-lib/lib/old_connection_suggestion_action";
import { HostListProvider } from "aws-wrapper-common-lib/lib/host_list_provider/host_list_provider";
import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";

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
const mockChanges: Set<HostChangeOptions> = mock(Set<HostChangeOptions>);

const mockConnectFunc = jest.fn().mockImplementation(() => {
  return mockReaderClient;
});

const mockExecuteFuncThrowsFailoverSuccessError = jest.fn().mockImplementation(() => {
  throw new FailoverSuccessError("test");
});

describe("reader write splitting test", () => {
  beforeEach(() => {
    when(mockPluginService.getHostListProvider()).thenReturn(instance(mockHostListProvider));
    when(mockPluginService.getHosts()).thenReturn(defaultHosts);
    when(mockPluginService.isInTransaction()).thenReturn(false);
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
    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockDialect.getConnectFunc(anything())).thenReturn(() => Promise.resolve());
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockReaderClient);

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, undefined, undefined);

    await target.switchClientIfRequired(true);
    verify(mockPluginService.refreshHostList()).once();
    verify(mockPluginService.setCurrentClient(mockReaderClient, readerHost1)).once();
    expect(target.readerTargetClient).toBe(mockReaderClient);
  });

  it("test set read only false", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(writerHost);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockReaderClient));
    when(await mockReaderClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerHost1);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockDialect.getConnectFunc(anything())).thenReturn(() => Promise.resolve());
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockWriterClient);

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, mockWriterClient, undefined);

    await target.switchClientIfRequired(false);
    verify(mockPluginService.setCurrentClient(mockWriterClient, writerHost)).once();
    expect(target.writerTargetClient).toEqual(mockWriterClient);
  });

  it("test set read only true already on reader", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockReaderClient));
    when(await mockReaderClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerHost1);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockDialect.getConnectFunc(anything())).thenReturn(() => Promise.resolve());
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockReaderClient);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderServiceInstance,
      undefined,
      mockReaderClient
    );

    await target.switchClientIfRequired(true);
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.readerTargetClient).toEqual(mockReaderClient);
    expect(target.writerTargetClient).toEqual(undefined);
  });

  it("test set read only false already on reader", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);
    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockDialect.getConnectFunc(anything())).thenReturn(() => Promise.resolve());
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockReaderClient);

    const target = new ReadWriteSplittingPlugin(
      mockPluginServiceInstance,
      properties,
      mockHostListProviderServiceInstance,
      mockWriterClient,
      undefined
    );

    await target.switchClientIfRequired(false);
    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.writerTargetClient).toEqual(mockWriterClient);
    expect(target.readerTargetClient).toEqual(undefined);
  });

  it("test set read only true one host", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn([writerHost]);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(writerHost);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockWriterClient));
    when(await mockWriterClient.isValid()).thenReturn(true);
    when(await mockPluginService.isClientValid(mockWriterClient)).thenReturn(true);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockDialect.getConnectFunc(anything())).thenReturn(() => Promise.resolve());
    when(mockPluginService.connect(anything(), anything())).thenReturn(mockWriterClient);

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, mockWriterClient, undefined);

    await target.switchClientIfRequired(true);

    verify(mockPluginService.setCurrentClient(anything(), anything())).never();
    expect(target.readerTargetClient).toEqual(undefined);
    expect(target.writerTargetClient).toEqual(mockWriterClient);
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

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderServiceInstance, undefined, undefined);

    await target.connect(writerHost, properties, true, mockConnectFunc);
    verify(mockHostListProviderService.setInitialConnectionHostInfo(anything())).once();
    expect(mockConnectFunc).toHaveBeenCalled();
  });

  it("test set read only false writer connection failed", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getHostInfoByStrategy(anything(), anything())).thenReturn(readerHost1);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockReaderClient));
    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerHost1);
    when(await mockPluginService.connect(writerHost, properties)).thenReject();

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, undefined, mockReaderClient);

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
      mockWriterClient,
      undefined
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

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, mockWriterClient, undefined);

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
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(await mockPluginService.isClientValid(mockWriterClient)).thenReturn(true);
    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, mockWriterClient, undefined);

    await expect(async () => {
      await target.execute("query", mockExecuteFuncThrowsFailoverSuccessError, "test");
    }).rejects.toThrow(new FailoverSuccessError("test"));

    verify(mockPluginService.tryClosingTargetClient(mockWriterClient)).once();
  });

  it("test notify connection changed", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn(defaultHosts);
    when(mockPluginService.getCurrentClient()).thenReturn(mockWriterClient);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, undefined, undefined);

    const suggestion = target.notifyConnectionChanged(mockChanges);
    expect(suggestion).toEqual(OldConnectionSuggestionAction.NO_OPINION);
  });

  it("test notify non initial connection", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);

    when(mockPluginService.getHosts()).thenReturn(singleReaderTopology);
    when(mockPluginService.getCurrentClient()).thenReturn(mockWriterClient);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(writerHost);
    when(mockPluginService.acceptsStrategy(anything(), anything())).thenReturn(true);

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderService, mockWriterClient, undefined);

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

    const target = new ReadWriteSplittingPlugin(mockPluginServiceInstance, properties, mockHostListProviderServiceInstance, undefined, undefined);

    await expect(async () => await target.connect(writerHost, properties, true, mockConnectFunc)).rejects.toThrow(AwsWrapperError);
    verify(mockHostListProviderService.setInitialConnectionHostInfo(anything())).never();
  });
});
