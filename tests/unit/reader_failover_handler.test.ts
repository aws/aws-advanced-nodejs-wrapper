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

import { HostInfo } from "../../common/lib/host_info";
import { PluginService } from "../../common/lib/plugin_service";
import { ClusterAwareReaderFailoverHandler } from "../../common/lib/plugins/failover/reader_failover_handler";
import { HostAvailability } from "../../common/lib/host_availability/host_availability";
import { HostRole } from "../../common/lib/host_role";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { anything, instance, mock, reset, verify, when } from "ts-mockito";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { PgDatabaseDialect } from "../../pg/lib/dialect/pg_database_dialect";
import { NodePostgresDriverDialect } from "../../pg/lib/dialect/node_postgres_driver_dialect";
import { PgClientWrapper } from "../../common/lib/pg_client_wrapper";

const host1 = new HostInfo("writer", 1234, HostRole.WRITER);
const host2 = new HostInfo("reader1", 1234, HostRole.READER);
const host3 = new HostInfo("reader2", 1234, HostRole.READER);
const host4 = new HostInfo("reader3", 1234, HostRole.READER);
const host5 = new HostInfo("reader4", 1234, HostRole.READER);
const host6 = new HostInfo("reader5", 1234, HostRole.READER);
const defaultHosts = [host1, host2, host3, host4, host5, host6];
const properties = new Map();
const mockDatabaseDialect = mock(PgDatabaseDialect);
const mockDriverDialect = mock(NodePostgresDriverDialect);
const mockClientWrapper: ClientWrapper = mock(PgClientWrapper);

const mockPluginService = mock(PluginService);

describe("reader failover handler", () => {
  beforeEach(() => {
    when(mockDatabaseDialect.getFailoverRestrictions()).thenReturn([]);
    when(mockPluginService.getDialect()).thenReturn(instance(mockDatabaseDialect));
    when(mockPluginService.getDriverDialect()).thenReturn(instance(mockDriverDialect));
    when(mockDriverDialect.connect(anything(), anything())).thenResolve(mockClientWrapper);
  });
  afterEach(() => {
    reset(mockPluginService);
  });

  it("test failover", async () => {
    const hosts = [...defaultHosts];
    const currentHostIndex = 2;
    const successHostIndex = 3;

    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(await mockPluginService.getHostRole(anything())).thenReturn(HostRole.READER);

    for (let i = 0; i < hosts.length; i++) {
      if (i !== successHostIndex) {
        when(mockPluginService.forceConnect(hosts[i], anything())).thenThrow(new AwsWrapperError("Rejecting test"));
        when(mockPluginService.isNetworkError(anything())).thenReturn(true);
      } else {
        when(mockPluginService.forceConnect(hosts[i], anything())).thenResolve(mockClientWrapper);
      }
    }
    const mockPluginServiceInstance = instance(mockPluginService);

    hosts[currentHostIndex].setAvailability(HostAvailability.NOT_AVAILABLE);
    hosts[successHostIndex].setAvailability(HostAvailability.NOT_AVAILABLE);

    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      ClusterAwareReaderFailoverHandler.DEFAULT_FAILOVER_TIMEOUT,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      false
    );
    const result = await target.failover(hosts, hosts[currentHostIndex]);
    expect(result.isConnected).toBe(true);
    expect(result.client).toBe(mockClientWrapper);
    expect(result.newHost).toBe(hosts[successHostIndex]);
  }, 30000);

  it("test failover timeout", async () => {
    // original host list: [active writer, active reader, current connection (reader), active
    // reader, down reader, active reader]
    // priority order by index (the subsets will be shuffled): [[1, 3, 5], 0, [2, 4]]
    // connection attempts are made in pairs using the above list
    // expected test result: failure to get reader since process is limited to 5s and each attempt
    // to connect takes 20s
    let timeoutId: any = -1;
    const hosts = [...defaultHosts];
    const currentHostIndex = 2;

    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.forceConnect(anything(), properties)).thenCall(async () => {
      await new Promise((resolve, reject) => {
        timeoutId = setTimeout(resolve, 20000);
      });
      return;
    });
    const mockPluginServiceInstance = instance(mockPluginService);

    hosts[currentHostIndex].setAvailability(HostAvailability.NOT_AVAILABLE);
    hosts[4].setAvailability(HostAvailability.NOT_AVAILABLE);

    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      5000,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      false
    );

    const startTime = Date.now();
    const result = await target.failover(hosts, hosts[currentHostIndex]);
    const duration = Date.now() - startTime;
    expect(result.isConnected).toBe(false);
    expect(result.client).toBe(null);
    expect(result.newHost).toBe(null);

    // 5s is a max allowed failover timeout; add 1s for inaccurate measurements
    expect(duration < 6000).toBe(true);
    clearTimeout(timeoutId);
  }, 10000);

  it("test failover with empty host list", async () => {
    when(mockPluginService.getHosts()).thenReturn([]);
    const currentHost = host1;

    const mockPluginServiceInstance = instance(mockPluginService);
    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      5000,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      false
    );

    const result = await target.failover([], currentHost);
    expect(result.isConnected).toBe(false);
    expect(result.client).toBe(null);
    expect(result.newHost).toBe(null);
  });

  it("test get reader connection success", async () => {
    // even number of connection attempts
    // first connection attempt to return succeeds, second attempt cancelled
    // expected test result: successful connection to either host
    let timeoutId: any = -1;
    const hosts = [host1, host2, host3]; // 2 connection attempts (writer not attempted)
    const slowHost = hosts[1];
    const fastHost = hosts[2];

    when(mockPluginService.getHosts()).thenReturn([]);
    when(mockPluginService.forceConnect(slowHost, anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        timeoutId = setTimeout(resolve, 20000);
      });
      return mockClientWrapper;
    });
    when(mockPluginService.forceConnect(fastHost, anything())).thenResolve(mockClientWrapper);

    const mockPluginServiceInstance = instance(mockPluginService);
    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      ClusterAwareReaderFailoverHandler.DEFAULT_FAILOVER_TIMEOUT,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      false
    );

    const result = await target.getReaderConnection(hosts);

    expect(result.isConnected).toBe(true);
    expect(result.client).toStrictEqual(mockClientWrapper);

    verify(mockPluginService.setAvailability(anything(), HostAvailability.NOT_AVAILABLE)).never();
    verify(mockPluginService.setAvailability(fastHost.allAliases, HostAvailability.AVAILABLE)).atMost(2);
    clearTimeout(timeoutId);
  }, 30000);

  it("test get reader connection failure", async () => {
    // odd number of connection attempts
    // first connection attempt to return fails
    // expected test result: failure to get reader
    const hosts = [host1, host2, host3, host4]; // 3 connection attempts (writer not attempted)
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.forceConnect(anything(), anything())).thenThrow(new AwsWrapperError());
    const mockPluginServiceInstance = instance(mockPluginService);

    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      ClusterAwareReaderFailoverHandler.DEFAULT_FAILOVER_TIMEOUT,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      false
    );

    const result = await target.getReaderConnection(hosts);
    expect(result.isConnected).toStrictEqual(false);
    expect(result.client).toStrictEqual(null);
    expect(result.newHost).toStrictEqual(null);
  });

  it("test get reader connection attempts timeout", async () => {
    // connection attempts time out before they can succeed
    // first connection attempt to return times out
    // expected test result: failure to get reader
    let timeoutId: any = -1;
    const hosts = [host1, host2, host3]; // 2 connection attempts (writer not attempted)

    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(mockPluginService.forceConnect(anything(), anything())).thenCall(async () => {
      await new Promise((resolve, reject) => {
        timeoutId = setTimeout(resolve, 10000);
      });
      return;
    });

    const mockPluginServiceInstance = instance(mockPluginService);
    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      ClusterAwareReaderFailoverHandler.DEFAULT_FAILOVER_TIMEOUT,
      1000,
      false
    );

    const result = await target.getReaderConnection(hosts);
    expect(result.isConnected).toBe(false);
    expect(result.client).toBe(null);
    expect(result.newHost).toBe(null);
    clearTimeout(timeoutId);
  }, 10000);

  it("test get host tuples by priority", async () => {
    const originalHosts = [...defaultHosts];
    originalHosts[2].setAvailability(HostAvailability.NOT_AVAILABLE);
    originalHosts[4].setAvailability(HostAvailability.NOT_AVAILABLE);
    originalHosts[5].setAvailability(HostAvailability.NOT_AVAILABLE);

    const mockPluginServiceInstance = instance(mockPluginService);
    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      ClusterAwareReaderFailoverHandler.DEFAULT_FAILOVER_TIMEOUT,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      false
    );

    const hostsByPriority = target.getHostsByPriority(originalHosts);

    let i = 0;

    // expecting active readers
    while (
      i < hostsByPriority.length &&
      hostsByPriority[i].role === HostRole.READER &&
      hostsByPriority[i].availability === HostAvailability.AVAILABLE
    ) {
      i++;
    }

    // expecting a writer
    while (i < hostsByPriority.length && hostsByPriority[i].role === HostRole.WRITER) {
      i++;
    }

    // expecting down readers
    while (
      i < hostsByPriority.length &&
      hostsByPriority[i].role === HostRole.READER &&
      hostsByPriority[i].availability === HostAvailability.NOT_AVAILABLE
    ) {
      i++;
    }

    expect(i).toBe(hostsByPriority.length);
  });

  it("test get reader tuples by priority", async () => {
    const originalHosts = [...defaultHosts];
    originalHosts[2].setAvailability(HostAvailability.NOT_AVAILABLE);
    originalHosts[4].setAvailability(HostAvailability.NOT_AVAILABLE);
    originalHosts[5].setAvailability(HostAvailability.NOT_AVAILABLE);

    const mockPluginServiceInstance = instance(mockPluginService);
    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      ClusterAwareReaderFailoverHandler.DEFAULT_FAILOVER_TIMEOUT,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      false
    );

    const hostsByPriority = target.getReaderHostsByPriority(originalHosts);

    let i = 0;

    // expecting active readers
    while (
      i < hostsByPriority.length &&
      hostsByPriority[i].role === HostRole.READER &&
      hostsByPriority[i].availability === HostAvailability.AVAILABLE
    ) {
      i++;
    }

    // expecting down readers
    while (
      i < hostsByPriority.length &&
      hostsByPriority[i].role === HostRole.READER &&
      hostsByPriority[i].availability === HostAvailability.NOT_AVAILABLE
    ) {
      i++;
    }

    expect(i).toBe(hostsByPriority.length);
  });

  it("test host failover strict reader enabled", async () => {
    const writer = new HostInfo("writer", 1234, HostRole.WRITER);
    const reader = new HostInfo("reader", 1234, HostRole.READER);
    const hosts = [writer, reader];
    when(mockPluginService.getHosts()).thenReturn(hosts);
    when(await mockPluginService.getHostRole(anything()))
      .thenReturn(HostRole.READER)
      .thenReturn(HostRole.WRITER);

    const mockPluginServiceInstance = instance(mockPluginService);
    const target = new ClusterAwareReaderFailoverHandler(
      mockPluginServiceInstance,
      properties,
      ClusterAwareReaderFailoverHandler.DEFAULT_FAILOVER_TIMEOUT,
      ClusterAwareReaderFailoverHandler.DEFAULT_READER_CONNECT_TIMEOUT,
      true
    );

    // We expect only reader nodes to be chosen.
    let hostsByPriority = target.getHostsByPriority(hosts);
    expect(hostsByPriority).toStrictEqual([reader, writer]);

    // Should pick the reader even if unavailable.
    reader.setAvailability(HostAvailability.NOT_AVAILABLE);

    hostsByPriority = target.getHostsByPriority(hosts);
    expect(hostsByPriority).toStrictEqual([writer, reader]);

    // Writer node will only be picked if it is the only node in topology;
    hostsByPriority = target.getHostsByPriority([writer]);
    expect(hostsByPriority).toStrictEqual([writer]);
  });
});
