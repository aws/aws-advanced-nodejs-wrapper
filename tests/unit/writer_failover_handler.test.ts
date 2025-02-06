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

import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { PluginService } from "../../common/lib/plugin_service";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { ClusterAwareReaderFailoverHandler } from "../../common/lib/plugins/failover/reader_failover_handler";
import { ClusterAwareWriterFailoverHandler } from "../../common/lib/plugins/failover/writer_failover_handler";
import { mock, instance, when, anything, verify, reset } from "ts-mockito";
import { HostAvailability } from "../../common/lib/host_availability/host_availability";
import { ReaderFailoverResult } from "../../common/lib/plugins/failover/reader_failover_result";
import { AwsPGClient } from "../../pg/lib";
import { WriterFailoverResult } from "../../common/lib/plugins/failover/writer_failover_result";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { PgDatabaseDialect } from "../../pg/lib/dialect/pg_database_dialect";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";

const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });

const newWriterHost = builder.withHost("new-writer-host").build();
const writer = builder.withHost("writer-host").build();
const readerA = builder.withHost("reader-a-host").build();
const readerB = builder.withHost("reader-b-host").build();
const topology = [writer, readerA, readerB];
const newTopology = [newWriterHost, readerA, readerB];

const properties = new Map<string, any>();

const mockClient = mock(AwsPGClient); // Using AwsPGClient in order to have abstract method implementations.
const mockClientInstance = instance(mockClient);
const mockPluginService = mock(PluginService);
const mockReaderFailover = mock(ClusterAwareReaderFailoverHandler);

const mockTargetClient = { client: 123 };
const mockClientWrapper: ClientWrapper = new MySQLClientWrapper(
  mockTargetClient,
  builder.withHost("host").build(),
  new Map<string, any>(),
  new MySQL2DriverDialect()
);

const mockTargetClientB = { client: 456 };
const mockClientWrapperB: ClientWrapper = new MySQLClientWrapper(
  mockTargetClientB,
  builder.withHost("host").build(),
  new Map<string, any>(),
  new MySQL2DriverDialect()
);

describe("writer failover handler", () => {
  beforeEach(() => {
    writer.addAlias("writer-host");
    newWriterHost.addAlias("new-writer-host");
    readerA.addAlias("reader-a-host");
    readerB.addAlias("reader-b-host");

    when(mockPluginService.getDialect()).thenReturn(new PgDatabaseDialect());
  });

  afterEach(() => {
    reset(mockPluginService);
    reset(mockReaderFailover);
  });

  it("test reconnect to writer - task B reader error", async () => {
    when(mockPluginService.forceConnect(writer, anything())).thenResolve(mockClientWrapper);
    when(mockPluginService.forceConnect(readerA, anything())).thenThrow(new AwsWrapperError());
    when(mockPluginService.forceConnect(readerB, anything())).thenThrow(new AwsWrapperError());
    when(mockPluginService.getHosts()).thenReturn(topology);
    when(mockReaderFailover.getReaderConnection(anything())).thenThrow(new AwsWrapperError());
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 5000, 2000, 2000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(false);
    expect(result.client).toBe(mockClientWrapper);

    verify(mockPluginService.setAvailability(writer.allAliases, HostAvailability.AVAILABLE)).called();
  });

  it("test reconnect to writer - slow reader A", async () => {
    let timeoutId: any = -1;
    when(mockPluginService.forceConnect(writer, anything())).thenResolve(mockClientWrapper);
    when(mockPluginService.forceConnect(readerA, anything())).thenResolve(mockClientWrapperB);
    when(mockPluginService.forceConnect(readerB, anything())).thenThrow(new AwsWrapperError());
    when(mockPluginService.getHosts()).thenReturn(topology).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        timeoutId = setTimeout(resolve, 5000);
      });
      return Promise.resolve(new ReaderFailoverResult(mockClientWrapper, readerA, true));
    });
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 60000, 5000, 5000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(false);
    expect(result.client).toBe(mockClientWrapper);

    verify(mockPluginService.setAvailability(writer.allAliases, HostAvailability.AVAILABLE)).called();
    clearTimeout(timeoutId);
  }, 10000);

  it("test reconnect to writer - task B defers", async () => {
    let timeoutId: any = -1;
    when(mockPluginService.forceConnect(writer, anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        timeoutId = setTimeout(resolve, 5000);
      });
      return mockClientWrapper;
    });
    when(mockPluginService.getCurrentClient()).thenReturn(mockClientInstance);
    when(mockPluginService.forceConnect(readerA, anything())).thenResolve(mockClientWrapperB);
    when(mockPluginService.forceConnect(readerB, anything())).thenThrow(new AwsWrapperError());
    when(mockPluginService.getHosts()).thenReturn(topology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockClientWrapper, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 60000, 2000, 2000);
    const result: WriterFailoverResult = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(false);
    expect(result.client).toBe(mockClientWrapper);

    verify(mockPluginService.setAvailability(writer.allAliases, HostAvailability.AVAILABLE)).called();
    clearTimeout(timeoutId);
  }, 10000);

  it("test connect to reader A - slow writer", async () => {
    let timeoutId: any = -1;
    when(mockPluginService.forceConnect(writer, anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        timeoutId = setTimeout(resolve, 5000);
      });
      return mockClientWrapperB;
    });
    when(mockPluginService.forceConnect(newWriterHost, anything())).thenResolve(mockClientWrapper);
    when(mockPluginService.forceConnect(readerA, anything())).thenResolve(mockClientWrapperB);
    when(mockPluginService.forceConnect(readerB, anything())).thenThrow(new AwsWrapperError());
    when(mockPluginService.getCurrentClient()).thenReturn(mockClientInstance);
    when(mockPluginService.getHosts()).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockClientWrapper, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target: ClusterAwareWriterFailoverHandler = new ClusterAwareWriterFailoverHandler(
      mockPluginServiceInstance,
      mockReaderFailoverInstance,
      properties,
      60000,
      5000,
      5000
    );
    const result: WriterFailoverResult = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(true);
    expect(result.client).toBe(mockClientWrapper);
    expect(result.topology.length).toBe(3);
    expect(result.topology[0].host).toBe("new-writer-host");

    verify(mockPluginService.setAvailability(newWriterHost.allAliases, HostAvailability.AVAILABLE)).once();
    clearTimeout(timeoutId);
  }, 10000);

  it("test connect to reader A - task A defers", async () => {
    let timeoutId: any = -1;
    when(mockPluginService.forceConnect(newWriterHost, anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        timeoutId = setTimeout(resolve, 5000);
      });
      return mockClientWrapper;
    });

    const newTopology = [newWriterHost, writer, readerA, readerB];
    when(mockPluginService.getCurrentClient()).thenReturn(mockClientInstance);
    when(mockPluginService.getHosts()).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockClientWrapper, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 60000, 5000, 2000);
    const result: WriterFailoverResult = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(true);
    expect(result.client).toBe(mockClientWrapper);
    expect(result.topology.length).toBe(4);
    expect(result.topology[0].host).toBe("new-writer-host");

    verify(mockPluginService.forceRefreshHostList(anything())).atLeast(1);
    verify(mockPluginService.setAvailability(newWriterHost.allAliases, HostAvailability.AVAILABLE)).once();
    clearTimeout(timeoutId);
  }, 10000);

  it("test failed to connect - failover timeout", async () => {
    let writerTimeoutId: any = -1;
    let newWriterTimeoutId: any = -1;
    when(mockPluginService.forceConnect(writer, anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        writerTimeoutId = setTimeout(resolve, 30000);
      });
      return;
    });
    when(mockPluginService.forceConnect(newWriterHost, anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        newWriterTimeoutId = setTimeout(resolve, 30000);
      });
      return;
    });

    when(mockPluginService.getCurrentClient()).thenReturn(mockClientInstance);
    when(mockPluginService.getHosts()).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockClientWrapper, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 5000, 2000, 2000);

    const startTime = Date.now();
    const result = await target.failover(topology);
    const duration = Date.now() - startTime;

    expect(result.isConnected).toBe(false);
    expect(result.isNewHost).toBe(false);

    // 5s is a max allowed failover timeout; add 1s for inaccurate measurements
    expect(duration < 6000).toBe(true);
    clearTimeout(writerTimeoutId);
    clearTimeout(newWriterTimeoutId);
  }, 10000);

  it("test failed to connect - task A error, task B writer error", async () => {
    const error = new AwsWrapperError();
    when(mockPluginService.forceConnect(writer, anything())).thenThrow(error);
    when(mockPluginService.forceConnect(newWriterHost, anything())).thenThrow(error);
    when(mockPluginService.isNetworkError(error)).thenReturn(true);
    when(mockPluginService.getHosts()).thenReturn(newTopology);
    when(mockPluginService.getCurrentClient()).thenReturn(mockClientInstance);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockClientWrapper, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 5000, 2000, 2000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(false);
    expect(result.isNewHost).toBe(false);

    verify(mockPluginService.setAvailability(newWriterHost.allAliases, HostAvailability.NOT_AVAILABLE)).atLeast(1);
  }, 10000);
});
