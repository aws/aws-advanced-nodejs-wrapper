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

import { SimpleHostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/simple_host_availability_strategy";
import { HostInfoBuilder } from "aws-wrapper-common-lib/lib/host_info_builder";
import { PluginService } from "aws-wrapper-common-lib/lib/plugin_service";
import { AwsWrapperError } from "aws-wrapper-common-lib/lib/utils/aws_wrapper_error";
import { ClusterAwareReaderFailoverHandler } from "aws-wrapper-common-lib/lib/plugins/failover/reader_failover_handler";
import { ClusterAwareWriterFailoverHandler } from "aws-wrapper-common-lib/lib/plugins/failover/writer_failover_handler";
import { mock, instance, when, anything, verify, reset } from "ts-mockito";
import { HostAvailability } from "aws-wrapper-common-lib/lib/host_availability/host_availability";
import { sleep } from "aws-wrapper-common-lib/lib/utils/utils";
import { ReaderFailoverResult } from "aws-wrapper-common-lib/lib/plugins/failover/reader_failover_result";
import { AwsPGClient } from "pg-wrapper/lib/client";

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
const mockWriterClientInstance = instance(mockClient);
const mockNewWriterClientInstance = instance(mockClient);
const mockReaderAClientInstance = instance(mockClient);
const mockReaderBClientInstance = instance(mockClient);
const mockPluginService = mock(PluginService);
const mockReaderFailover = mock(ClusterAwareReaderFailoverHandler);

describe("writer failover handler", () => {
  beforeEach(() => {
    writer.addAlias("writer-host");
    newWriterHost.addAlias("new-writer-host");
    readerA.addAlias("reader-a-host");
    readerB.addAlias("reader-b-host");
  });

  afterEach(() => {
    reset(mockPluginService);
    reset(mockReaderFailover);
  });

  it("test reconnect to writer - task B reader exception", async () => {
    when(mockPluginService.createTargetClientAndConnect(writer, properties, true)).thenReturn(Promise.resolve(mockClientInstance));
    when(mockPluginService.createTargetClientAndConnect(readerA, properties, true)).thenThrow(new AwsWrapperError());
    when(mockPluginService.createTargetClientAndConnect(readerB, properties, true)).thenThrow(new AwsWrapperError());
    when(mockPluginService.getHosts()).thenReturn(topology);
    when(mockReaderFailover.getReaderConnection(anything())).thenThrow(new AwsWrapperError());
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 5000, 2000, 2000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(false);
    expect(result.client).toBe(mockClientInstance);

    verify(mockPluginService.setAvailability(writer.allAliases, HostAvailability.AVAILABLE)).called();
  });

  it("test reconnect to writer - slow reader A", async () => {
    when(mockPluginService.createTargetClientAndConnect(writer, properties, true)).thenReturn(Promise.resolve(mockWriterClientInstance));
    when(mockPluginService.createTargetClientAndConnect(readerB, properties, true)).thenThrow(new AwsWrapperError());
    when(mockPluginService.createTargetClientAndConnect(newWriterHost, properties, true)).thenReturn(Promise.resolve(mockNewWriterClientInstance));
    when(mockPluginService.getHosts()).thenReturn(topology).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenCall(async () => {
      await sleep(5000);
      return Promise.resolve(new ReaderFailoverResult(mockReaderAClientInstance, readerA, true));
    });
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 60000, 5000, 5000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(false);
    expect(result.client).toBe(mockWriterClientInstance);

    verify(mockPluginService.setAvailability(writer.allAliases, HostAvailability.AVAILABLE)).called();
  }, 10000);

  it("test reconnect to writer - task B defers", async () => {
    when(mockPluginService.createTargetClientAndConnect(writer, properties, true)).thenCall(async () => {
      await sleep(5000);
      return Promise.resolve(mockWriterClientInstance);
    });
    when(mockPluginService.createTargetClientAndConnect(readerB, properties, true)).thenThrow(new AwsWrapperError());
    when(mockPluginService.getHosts()).thenReturn(topology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockReaderAClientInstance, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 60000, 2000, 2000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(false);
    expect(result.client).toBe(mockWriterClientInstance);

    verify(mockPluginService.setAvailability(writer.allAliases, HostAvailability.AVAILABLE)).called();
  }, 10000);

  it("test connect to reader A - slow writer", async () => {
    when(mockPluginService.createTargetClientAndConnect(newWriterHost, properties, true)).thenReturn(Promise.resolve(mockNewWriterClientInstance));
    when(mockPluginService.createTargetClientAndConnect(readerA, properties, true)).thenReturn(Promise.resolve(mockReaderAClientInstance));
    when(mockPluginService.createTargetClientAndConnect(readerB, properties, true)).thenReturn(Promise.resolve(mockReaderBClientInstance));
    when(mockPluginService.createTargetClientAndConnect(writer, properties, true)).thenCall(async () => {
      await sleep(5000);
      return Promise.resolve(mockWriterClientInstance);
    });

    when(mockPluginService.getHosts()).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockReaderAClientInstance, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 60000, 5000, 5000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(true);
    expect(result.client).toBe(mockNewWriterClientInstance);
    expect(result.topology.length).toBe(3);
    expect(result.topology[0].host).toBe("new-writer-host");

    verify(mockPluginService.setAvailability(newWriterHost.allAliases, HostAvailability.AVAILABLE)).once();
  }, 10000);

  it("test connect to reader A - task A defers", async () => {
    when(mockPluginService.createTargetClientAndConnect(writer, properties, true)).thenReturn(Promise.resolve(mockClientInstance));
    when(mockPluginService.createTargetClientAndConnect(readerA, properties, true)).thenReturn(Promise.resolve(mockReaderAClientInstance));
    when(mockPluginService.createTargetClientAndConnect(readerB, properties, true)).thenReturn(Promise.resolve(mockReaderBClientInstance));
    when(mockPluginService.createTargetClientAndConnect(newWriterHost, properties, true)).thenCall(async () => {
      await sleep(5000);
      return Promise.resolve(mockNewWriterClientInstance);
    });

    const newTopology = [newWriterHost, writer, readerA, readerB];
    when(mockPluginService.getHosts()).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockReaderAClientInstance, readerA, true));
    const mockReaderFailoverInstance = instance(mockReaderFailover);
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareWriterFailoverHandler(mockPluginServiceInstance, mockReaderFailoverInstance, properties, 60000, 5000, 5000);
    const result = await target.failover(topology);

    expect(result.isConnected).toBe(true);
    expect(result.isNewHost).toBe(true);
    expect(result.client).toBe(mockNewWriterClientInstance);
    expect(result.topology.length).toBe(4);
    expect(result.topology[0].host).toBe("new-writer-host");

    verify(mockPluginService.forceRefreshHostList(anything())).atLeast(1);
    verify(mockPluginService.setAvailability(newWriterHost.allAliases, HostAvailability.AVAILABLE)).once();
  }, 10000);

  it("test failed to connect - failover timeout", async () => {
    when(mockPluginService.createTargetClientAndConnect(readerA, properties, true)).thenReturn(Promise.resolve(mockReaderAClientInstance));
    when(mockPluginService.createTargetClientAndConnect(readerB, properties, true)).thenReturn(Promise.resolve(mockReaderBClientInstance));
    when(mockPluginService.createTargetClientAndConnect(writer, properties, true)).thenCall(async () => {
      await sleep(30000);
      return Promise.resolve(mockWriterClientInstance);
    });
    when(mockPluginService.createTargetClientAndConnect(newWriterHost, properties, true)).thenCall(async () => {
      await sleep(30000);
      return Promise.resolve(mockNewWriterClientInstance);
    });

    when(mockPluginService.getHosts()).thenReturn(newTopology);
    when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockReaderAClientInstance, readerA, true));
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
  }, 10000);

  // // failing due to missing isNetworkError
  // it("test failed to connect - task A exception, task B writer exception", async () => {
  //   const error = new AwsWrapperError();
  //   when(mockPluginService.createTargetClientAndConnect(writer, properties, true)).thenThrow(error);
  //   when(mockPluginService.createTargetClientAndConnect(readerA, properties, true)).thenReturn(Promise.resolve(mockReaderAClientInstance));
  //   when(mockPluginService.createTargetClientAndConnect(readerB, properties, true)).thenReturn(Promise.resolve(mockReaderBClientInstance));
  //   when(mockPluginService.createTargetClientAndConnect(newWriterHost, properties, true)).thenThrow(new AwsWrapperError());
  //   when(mockPluginService.isNetworkError(error)).thenReturn(true);
  //   when(mockPluginService.getHosts()).thenReturn(newTopology);
  //   when(mockReaderFailover.getReaderConnection(anything())).thenResolve(new ReaderFailoverResult(mockReaderAClientInstance, readerA, true));
  //   const mockReaderFailoverInstance = instance(mockReaderFailover);
  //   const mockPluginServiceInstance = instance(mockPluginService);

  //   const target = new ClusterAwareWriterFailoverHandler(
  //     mockPluginServiceInstance,
  //     mockReaderFailoverInstance,
  //     properties,
  //     5000,
  //     2000,
  //     2000
  //   );
  //   const result = await target.failover(topology);

  //   expect(result.isConnected).toBe(false);
  //   expect(result.isNewHost).toBe(false);

  //   verify(mockPluginService.setAvailability(newWriterHost.allAliases, HostAvailability.NOT_AVAILABLE)).atLeast(1);
  // }, 10000);
});
