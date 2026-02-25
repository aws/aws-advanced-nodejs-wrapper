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

import { RdsHostListProvider } from "../../common/lib/host_list_provider/rds_host_list_provider";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { AwsClient } from "../../common/lib/aws_client";
import { AwsWrapperError, HostInfo, HostInfoBuilder, HostRole } from "../../common/lib";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { ConnectionUrlParser } from "../../common/lib/utils/connection_url_parser";
import { AwsPGClient } from "../../pg/lib";
import { convertMsToNanos, sleep } from "../../common/lib/utils/utils";
import { AuroraPgDatabaseDialect } from "../../pg/lib/dialect/aurora_pg_database_dialect";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { PgConnectionUrlParser } from "../../pg/lib/pg_connection_url_parser";
import { PgClientWrapper } from "../../common/lib/pg_client_wrapper";
import { CoreServicesContainer } from "../../common/lib/utils/core_services_container";
import { StorageService } from "../../common/lib/utils/storage/storage_service";
import { Topology } from "../../common/lib/host_list_provider/topology";

const mockClient: AwsClient = mock(AwsPGClient);
const mockDialect: AuroraPgDatabaseDialect = mock(AuroraPgDatabaseDialect);
const mockPluginService: PluginServiceImpl = mock(PluginServiceImpl);
const connectionUrlParser: ConnectionUrlParser = new PgConnectionUrlParser();

const hosts: HostInfo[] = [
  createHost({
    hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
    host: "host1"
  }),
  createHost({
    hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
    host: "host2"
  })
];

const currentHostInfo = createHost({
  host: "foo",
  port: 1234,
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
});

const clientWrapper: ClientWrapper = new PgClientWrapper(undefined, currentHostInfo, new Map<string, any>());

const mockClientWrapper: ClientWrapper = mock(clientWrapper);

const storageService: StorageService = CoreServicesContainer.getInstance().getStorageService();

const defaultRefreshRateNano: number = 5 * 1_000_000_000;

function createHost(config: any): HostInfo {
  const info = new HostInfoBuilder(config);
  return info.build();
}

function getRdsHostListProvider(originalHost: string): RdsHostListProvider {
  const provider = new RdsHostListProvider(new Map<string, any>(), originalHost, instance(mockPluginService));
  provider.init();
  return provider;
}

describe("testRdsHostListProvider", () => {
  beforeEach(() => {
    when(mockDialect.getDefaultPort()).thenReturn(-1);
    when(mockClient.isValid()).thenResolve(true);
    when(mockPluginService.getDialect()).thenReturn(instance(mockDialect));
    when(mockPluginService.getCurrentHostInfo()).thenReturn(currentHostInfo);
    when(mockPluginService.getConnectionUrlParser()).thenReturn(connectionUrlParser);
    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClient));
    when(mockPluginService.getHostInfoBuilder()).thenReturn(new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }));
  });

  afterEach(() => {
    RdsHostListProvider.clearAll();
    CoreServicesContainer.getInstance().getStorageService().clearAll();

    reset(mockDialect);
    reset(mockClientWrapper);
    reset(mockClient);
    reset(mockPluginService);
  });

  it("testGetTopology_returnCachedTopology", async () => {
    const rdsHostListProvider = getRdsHostListProvider("host");
    const spiedProvider = spy(rdsHostListProvider);

    const expected: HostInfo[] = hosts;
    storageService.set(rdsHostListProvider.clusterId, new Topology(expected));

    const result = await rdsHostListProvider.getTopology(mockClientWrapper, false);
    expect(result.hosts.length).toEqual(2);
    expect(result.hosts).toEqual(expected);

    verify(spiedProvider.queryForTopology(anything(), anything())).never();
  });

  it("testGetTopology_withForceUpdate_returnsUpdatedTopology", async () => {
    const rdsHostListProvider = getRdsHostListProvider("host");
    const spiedProvider = spy(rdsHostListProvider);
    spiedProvider.isInitialized = true;

    when(mockPluginService.isClientValid(anything())).thenResolve(true);

    storageService.set(rdsHostListProvider.clusterId, new Topology(hosts));
    const newHosts: HostInfo[] = [
      createHost({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
        host: "newHost"
      })
    ];

    when(mockClient.isValid()).thenResolve(true);
    when(spiedProvider.queryForTopology(mockClientWrapper, anything())).thenReturn(Promise.resolve(newHosts));

    const result = await rdsHostListProvider.getTopology(mockClientWrapper, true);
    expect(result.hosts.length).toEqual(1);
    expect(result.hosts).toEqual(newHosts);

    verify(spiedProvider.queryForTopology(anything(), anything())).atMost(1);
  });

  it("testGetTopology_noForceUpdate_queryReturnsEmptyHostList", async () => {
    const rdsHostListProvider = getRdsHostListProvider("host");
    const spiedProvider = spy(rdsHostListProvider);
    spiedProvider.clusterId = "cluster-id";
    spiedProvider.isInitialized = true;

    const expected: HostInfo[] = hosts;
    storageService.set(rdsHostListProvider.clusterId, new Topology(expected));
    when(spiedProvider.queryForTopology(mockClientWrapper, anything())).thenReturn(Promise.resolve([]));

    const result = await rdsHostListProvider.getTopology(mockClientWrapper, false);
    expect(result.hosts.length).toEqual(2);
    expect(result.hosts).toEqual(expected);
    verify(spiedProvider.queryForTopology(anything(), anything())).atMost(1);
  });

  it("testGetTopology_withForceUpdate_returnsInitialHostList", async () => {
    const initialHosts = [
      createHost({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
        host: "someUrl"
      })
    ];

    const rdsHostListProvider = getRdsHostListProvider("someUrl");
    const spiedProvider = spy(rdsHostListProvider);
    spiedProvider.clear();

    when(spiedProvider.queryForTopology(mockClientWrapper, anything())).thenReturn(Promise.resolve([]));

    const result = await rdsHostListProvider.getTopology(mockClientWrapper, true);
    expect(result.hosts).toBeTruthy();
    for (let i = 0; i < result.hosts.length; i++) {
      expect(result.hosts[i].equals(initialHosts[i])).toBeTruthy();
    }
    verify(spiedProvider.queryForTopology(anything(), anything())).atMost(1);
  });

  it("testQueryForTopology_queryResultsInError", async () => {
    const rdsHostListProvider = getRdsHostListProvider("someUrl");
    when(mockDialect.queryForTopology(anything(), anything())).thenThrow(new AwsWrapperError("bad things"));

    await expect(rdsHostListProvider.queryForTopology(instance(mockClientWrapper), instance(mockDialect))).rejects.toThrow(AwsWrapperError);
  });

  it("testGetCachedTopology_returnCachedTopology", () => {
    const rdsHostListProvider = getRdsHostListProvider("foo");

    const expected: HostInfo[] = hosts;
    storageService.set(rdsHostListProvider.clusterId, new Topology(expected));

    const result = rdsHostListProvider.getStoredTopology();
    expect(result).toEqual(expected);
  });

  it("testGetCachedTopology_returnNull", async () => {
    let rdsHostListProvider = getRdsHostListProvider("foo");
    expect(rdsHostListProvider.getStoredTopology()).toBeNull();
    rdsHostListProvider.clear();

    rdsHostListProvider = getRdsHostListProvider("foo");

    storageService.registerItemClassIfAbsent(Topology, true, convertMsToNanos(1));
    storageService.set(rdsHostListProvider.clusterId, new Topology(hosts));
    await sleep(2);

    expect(rdsHostListProvider.getStoredTopology()).toBeNull();
  });

  it("testIdentifyConnectionWithInvalidHostIdQuery", async () => {
    when(mockDialect.identifyConnection(anything())).thenThrow(new AwsWrapperError("bad things"));

    const rdsHostListProvider = getRdsHostListProvider("foo");
    await expect(rdsHostListProvider.identifyConnection(instance(mockClientWrapper), instance(mockDialect))).rejects.toThrow(AwsWrapperError);
  });

  it("testIdentifyConnectionHostInTopology", async () => {
    when(mockDialect.queryForTopology(anything(), anything())).thenResolve([
      createHost({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
        host: "instance-1"
      })
    ]);

    const rdsHostListProvider = getRdsHostListProvider("foo");
    const spiedProvider = spy(rdsHostListProvider);

    rdsHostListProvider.clusterInstanceTemplate = createHost({
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
      host: "?.pattern"
    });

    when(spiedProvider.refresh()).thenReturn(Promise.resolve([]));
    const res = await rdsHostListProvider.identifyConnection(instance(mockClientWrapper), instance(mockDialect));
    expect(res).toBeNull();
  });

  it("testGetTopology_staleRecord", async () => {
    const hostName1: string = "hostName1";
    const hostName2: string = "hostName2";
    const cpuUtilization: number = 11.1;
    const lag: number = 0.123;
    const firstTimestamp: number = Date.now();
    const secondTimestamp: number = firstTimestamp + 100;
    const weight = Math.round(lag) * 100 + Math.round(cpuUtilization);

    const expectedWriter: HostInfo = createHost({
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
      host: hostName2,
      weight: weight,
      lastUpdateTime: secondTimestamp
    });

    when(mockDialect.queryForTopology(anything(), anything())).thenResolve([
      createHost({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
        host: hostName1,
        role: HostRole.WRITER,
        weight: Math.round(lag) * 100 + Math.round(cpuUtilization),
        lastUpdateTime: firstTimestamp
      }),
      createHost({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
        host: hostName2,
        role: HostRole.WRITER,
        weight: Math.round(lag) * 100 + Math.round(cpuUtilization),
        lastUpdateTime: secondTimestamp
      })
    ]);

    when(mockPluginService.isClientValid(anything())).thenResolve(true);
    when(mockPluginService.getDialect()).thenReturn(instance(mockDialect));

    const rdsHostListProvider = getRdsHostListProvider("foo");
    const spiedProvider = spy(rdsHostListProvider);
    rdsHostListProvider.isInitialized = false;

    when(spiedProvider.queryForTopology(mockClientWrapper, anything())).thenReturn(Promise.resolve([]));

    const result = await rdsHostListProvider.getTopology(instance(mockClientWrapper), true);
    verify(spiedProvider.queryForTopology(anything(), anything())).atMost(1);
    expect(result.hosts.length).toEqual(1);
    expect(result.hosts[0].equals(expectedWriter)).toBeTruthy();
  });
});
