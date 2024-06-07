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
import { FailoverPlugin } from "../../common/lib/plugins/failover/failover_plugin";
import { ClusterAwareReaderFailoverHandler } from "../../common/lib/plugins/failover/reader_failover_handler";
import { ReaderFailoverResult } from "../../common/lib/plugins/failover/reader_failover_result";
import { ClusterAwareWriterFailoverHandler } from "../../common/lib/plugins/failover/writer_failover_handler";
import { WriterFailoverResult } from "../../common/lib/plugins/failover/writer_failover_result";
import { AwsWrapperError, FailoverFailedError, FailoverSuccessError, TransactionResolutionUnknownError } from "../../common/lib/utils/errors";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { AwsMySQLClient } from "../../mysql/lib";
import { anything, instance, mock, reset, resetCalls, spy, verify, when } from "ts-mockito";
import { Messages } from "../../common/lib/utils/messages";
import { HostChangeOptions } from "../../common/lib/host_change_options";

const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });

const mockPluginService: PluginService = mock(PluginService);
const mockAwsClient: AwsClient = mock(AwsClient);
const mockMySQLClient: AwsClient = mock(AwsMySQLClient);
const mockHostInfo: HostInfo = mock(HostInfo);
const mockRdsHostListProvider: RdsHostListProvider = mock(RdsHostListProvider);
const mockReaderFailoverHandler: ClusterAwareReaderFailoverHandler = mock(ClusterAwareReaderFailoverHandler);
let mockReaderFailoverHandlerInstance;
let mockWriterFailoverHandlerInstance;
const mockWriterFailoverHandler: ClusterAwareWriterFailoverHandler = mock(ClusterAwareWriterFailoverHandler);
const mockReaderResult: ReaderFailoverResult = mock(ReaderFailoverResult);
const mockWriterResult: WriterFailoverResult = mock(WriterFailoverResult);

const properties: Map<string, any> = new Map();

let plugin: FailoverPlugin;

function initializePlugin(mockPluginServiceInstance: PluginService): void;
function initializePlugin(
  mockPluginServiceInstance: PluginService,
  readerFailoverHandler: ClusterAwareReaderFailoverHandler,
  writerFailoverHandler: ClusterAwareWriterFailoverHandler
): void;
function initializePlugin(
  mockPluginServiceInstance: PluginService,
  readerFailoverHandler?: ClusterAwareReaderFailoverHandler,
  writerFailoverHandler?: ClusterAwareWriterFailoverHandler
): void {
  plugin =
    readerFailoverHandler && writerFailoverHandler
      ? new FailoverPlugin(mockPluginServiceInstance, properties, new RdsUtils(), readerFailoverHandler, writerFailoverHandler)
      : new FailoverPlugin(mockPluginServiceInstance, properties, new RdsUtils());
}

describe("reader failover handler", () => {
  beforeEach(() => {
    when(mockRdsHostListProvider.getRdsUrlType()).thenReturn(RdsUrlType.RDS_WRITER_CLUSTER);
    when(mockPluginService.getHostListProvider()).thenReturn(instance(mockRdsHostListProvider));
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockAwsClient));
    when(mockPluginService.tryClosingTargetClient()).thenResolve();
    properties.clear();
  });

  afterEach(() => {
    reset(mockAwsClient);
    reset(mockMySQLClient);
    reset(mockHostInfo);
    reset(mockPluginService);
    reset(mockRdsHostListProvider);
    reset(mockReaderFailoverHandler);
    reset(mockWriterFailoverHandler);
    reset(mockReaderResult);
    reset(mockWriterResult);
  });

  it("test notify list changed with failover disabled", async () => {
    properties.set(WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.name, false);
    const changes: Map<string, Set<HostChangeOptions>> = new Map();

    initializePlugin(instance(mockPluginService));
    plugin.notifyHostListChanged(changes);

    verify(mockPluginService.getCurrentHostInfo()).never();
  });

  it("test notify list changed with valid connection not in topology", async () => {
    const changes: Map<string, Set<HostChangeOptions>> = new Map();
    changes.set("cluster-host/", new Set<HostChangeOptions>([HostChangeOptions.HOST_DELETED]));
    changes.set("instance/", new Set<HostChangeOptions>([HostChangeOptions.HOST_ADDED]));

    initializePlugin(instance(mockPluginService));
    plugin.notifyHostListChanged(changes);

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

    const spyPlugin: FailoverPlugin = spy(plugin);
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
    const spyPlugin: FailoverPlugin = spy(plugin);
    when(spyPlugin.failoverReader(mockHostInfoInstance)).thenResolve();
    plugin.failoverMode = FailoverMode.READER_OR_WRITER;

    await expect(plugin.failover(mockHostInfoInstance)).rejects.toThrow(new FailoverSuccessError(Messages.get("Failover.connectionChangedError")));

    verify(spyPlugin.failoverReader(mockHostInfoInstance)).once();
  });

  it("test failover reader with valid failed HostInfo - failover success", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];
    const mockAwsClientInstance = instance(mockAwsClient);

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "aslias2"]));
    when(mockHostInfo.getRawAvailability()).thenReturn(HostAvailability.AVAILABLE);
    when(mockPluginService.getHosts()).thenReturn(hosts);

    when(mockReaderResult.isConnected).thenReturn(true);
    when(mockReaderResult.client).thenReturn(mockAwsClientInstance);
    when(mockReaderResult.newHost).thenReturn(hostInfo);

    const mockPluginServiceInstance = instance(mockPluginService);
    const mockReaderResultInstance = instance(mockReaderResult);
    const mockHostInfoInstance = instance(mockHostInfo);
    when(mockReaderFailoverHandler.failover(anything(), anything())).thenResolve(mockReaderResultInstance);

    mockReaderFailoverHandlerInstance = instance(mockReaderFailoverHandler);
    mockWriterFailoverHandlerInstance = instance(mockWriterFailoverHandler);

    initializePlugin(mockPluginServiceInstance, mockReaderFailoverHandlerInstance, mockWriterFailoverHandlerInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    const spyPlugin: FailoverPlugin = spy(plugin);
    when(spyPlugin.updateTopology(true)).thenReturn();

    await plugin.failoverReader(mockHostInfoInstance);

    verify(mockReaderFailoverHandler.failover(anything(), anything())).once();
    verify(mockPluginService.setCurrentClient(mockAwsClientInstance, hostInfo)).once();
  });

  it("test failover reader with no failed host", async () => {
    const failedHost = builder.withHost("failed").build();
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];
    const test = new AwsWrapperError("test");

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "aslias2"]));
    when(mockHostInfo.getRawAvailability()).thenReturn(HostAvailability.AVAILABLE);
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockReaderResult.exception).thenReturn(test);
    when(mockReaderResult.newHost).thenReturn(hostInfo);
    when(mockReaderFailoverHandler.failover(anything(), anything())).thenResolve(instance(mockReaderResult));

    const mockHostInfoInstance = instance(mockHostInfo);
    const mockPluginServiceInstance = instance(mockPluginService);
    mockReaderFailoverHandlerInstance = instance(mockReaderFailoverHandler);
    mockWriterFailoverHandlerInstance = instance(mockWriterFailoverHandler);

    initializePlugin(mockPluginServiceInstance, mockReaderFailoverHandlerInstance, mockWriterFailoverHandlerInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    await expect(plugin.failoverReader(failedHost)).rejects.toThrow(test);
    verify(mockReaderFailoverHandlerInstance.failover(anything(), anything()));
  });

  it("test failover writer failed - failover throws exception", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];
    const test = new AwsWrapperError("test");

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "aslias2"]));
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockWriterResult.exception).thenReturn(test);
    when(mockWriterFailoverHandler.failover(anything())).thenResolve(instance(mockWriterResult));

    const mockHostInfoInstance = instance(mockHostInfo);
    const mockPluginServiceInstance = instance(mockPluginService);
    mockReaderFailoverHandlerInstance = instance(mockReaderFailoverHandler);
    mockWriterFailoverHandlerInstance = instance(mockWriterFailoverHandler);

    initializePlugin(mockPluginServiceInstance, mockReaderFailoverHandlerInstance, mockWriterFailoverHandlerInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    await expect(plugin.failoverWriter()).rejects.toThrow(test);
    verify(mockWriterFailoverHandler.failover(hosts)).once();
  });

  it("test failover writer failed - failover with no result", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "aslias2"]));
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockWriterResult.isConnected).thenReturn(false);
    when(mockWriterFailoverHandler.failover(anything())).thenResolve(instance(mockWriterResult));

    const mockHostInfoInstance = instance(mockHostInfo);
    const mockPluginServiceInstance = instance(mockPluginService);
    mockReaderFailoverHandlerInstance = instance(mockReaderFailoverHandler);
    mockWriterFailoverHandlerInstance = instance(mockWriterFailoverHandler);

    initializePlugin(mockPluginServiceInstance, mockReaderFailoverHandlerInstance, mockWriterFailoverHandlerInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    try {
      await plugin.failoverWriter();
    } catch (error) {
      if (!(error instanceof FailoverFailedError)) {
        throw error;
      }
    }

    verify(mockWriterFailoverHandler.failover(hosts)).once();
    verify(mockWriterResult.client).never();
    verify(mockWriterResult.topology).never();
  });

  it("test failover writer success", async () => {
    const hostInfo = builder.withHost("hostA").build();
    const hosts = [hostInfo];

    when(mockHostInfo.allAliases).thenReturn(new Set<string>(["alias1", "aslias2"]));
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockWriterResult.isConnected).thenReturn(false);
    when(mockWriterResult.topology).thenReturn(hosts);
    when(mockWriterFailoverHandler.failover(anything())).thenResolve(instance(mockWriterResult));

    const mockHostInfoInstance = instance(mockHostInfo);
    const mockPluginServiceInstance = instance(mockPluginService);
    mockReaderFailoverHandlerInstance = instance(mockReaderFailoverHandler);
    mockWriterFailoverHandlerInstance = instance(mockWriterFailoverHandler);

    initializePlugin(mockPluginServiceInstance, mockReaderFailoverHandlerInstance, mockWriterFailoverHandlerInstance);
    plugin.initHostProvider(mockHostInfoInstance, properties, mockPluginServiceInstance, () => {});

    try {
      await plugin.failoverWriter();
      throw new Error("Expected a FailoverFailedError to be thrown");
    } catch (error) {
      if (!(error instanceof FailoverFailedError)) {
        throw new Error("Expected a FailoverFailedError to be thrown");
      }
    }

    verify(mockWriterFailoverHandler.failover(hosts)).once();
  });

  it("test invalid current connection - no connection", async () => {
    when(mockAwsClient.targetClient).thenReturn(null);
    const mockAwsClientInstance = instance(mockAwsClient);

    when(mockPluginService.getCurrentClient()).thenReturn(mockAwsClientInstance);
    const mockPluginServiceInstance = instance(mockPluginService);

    initializePlugin(mockPluginServiceInstance);
    await plugin.invalidateCurrentClient();

    verify(mockPluginService.getCurrentHostInfo()).never();
  });

  it("test invalidate current connection - in transaction", async () => {
    when(mockMySQLClient.targetClient).thenReturn({});
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
    when(mockMySQLClient.targetClient).thenReturn({});
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
    when(mockMySQLClient.targetClient).thenReturn({});
    when(mockMySQLClient.isValid()).thenResolve(false);
    const mockMySQLClientInstance = instance(mockMySQLClient);

    when(mockPluginService.getCurrentClient()).thenReturn(mockMySQLClientInstance);
    when(mockPluginService.isInTransaction()).thenReturn(false);

    when(mockHostInfo.host).thenReturn("host");
    when(mockHostInfo.port).thenReturn(123);
    when(mockHostInfo.role).thenReturn(HostRole.READER);

    const mockPluginServiceInstance = instance(mockPluginService);
    mockReaderFailoverHandlerInstance = instance(mockReaderFailoverHandler);
    mockWriterFailoverHandlerInstance = instance(mockWriterFailoverHandler);

    initializePlugin(mockPluginServiceInstance, mockReaderFailoverHandlerInstance, mockWriterFailoverHandlerInstance);

    await plugin.invalidateCurrentClient();

    when(mockPluginService.tryClosingTargetClient()).thenThrow(new Error("test"));

    await plugin.invalidateCurrentClient();

    verify(mockPluginService.tryClosingTargetClient()).twice();
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
