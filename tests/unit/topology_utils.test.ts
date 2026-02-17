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

import { TopologyQueryResult, TopologyUtils } from "../../common/lib/host_list_provider/topology_utils";
import { anything, instance, mock, reset, when } from "ts-mockito";
import { HostInfo, HostInfoBuilder } from "../../common/lib";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { AuroraPgDatabaseDialect } from "../../pg/lib/dialect/aurora_pg_database_dialect";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { PgClientWrapper } from "../../common/lib/pg_client_wrapper";
import { HostRole } from "../../common/lib/host_role";
import { HostAvailability } from "../../common/lib/host_availability/host_availability";
import { PgDatabaseDialect } from "../../pg/lib/dialect/pg_database_dialect";

const mockDialect: AuroraPgDatabaseDialect = mock(AuroraPgDatabaseDialect);
const mockNonTopologyDialect: PgDatabaseDialect = mock(PgDatabaseDialect);

const currentHostInfo = createHost({
  host: "foo",
  port: 1234,
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
});

const clientWrapper: ClientWrapper = new PgClientWrapper(undefined, currentHostInfo, new Map<string, any>());
const mockClientWrapper: ClientWrapper = mock(clientWrapper);
const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });

function createHost(config: any): HostInfo {
  const info = new HostInfoBuilder(config);
  return info.build();
}

function getTopologyUtils(): TopologyUtils {
  return new TopologyUtils(instance(mockDialect), hostInfoBuilder);
}

describe("testTopologyUtils", () => {
  beforeEach(() => {
    reset(mockDialect);
    reset(mockClientWrapper);
    reset(mockNonTopologyDialect);
  });

  it("testQueryForTopology_withNonTopologyAwareDialect_throwsError", async () => {
    const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
    const topologyUtils = new TopologyUtils(instance(mockNonTopologyDialect) as any, hostInfoBuilder);

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const clusterInstanceTemplate = createHost({
      host: "?.cluster-endpoint",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    await expect(
      topologyUtils.queryForTopology(mockClientWrapper, instance(mockNonTopologyDialect), initialHost, clusterInstanceTemplate)
    ).rejects.toThrow(TypeError);
  });

  it("testQueryForTopology_returnsTopology", async () => {
    const topologyUtils = getTopologyUtils();
    const timestamp = Date.now();

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const clusterInstanceTemplate = createHost({
      host: "?.cluster-endpoint",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const queryResults: TopologyQueryResult[] = [
      new TopologyQueryResult("instance-1", true, 100, timestamp, 5432, "id-1"),
      new TopologyQueryResult("instance-2", false, 50, timestamp, 5432, "id-2")
    ];

    when(mockDialect.queryForTopology(anything())).thenResolve(queryResults);

    const result = await topologyUtils.queryForTopology(mockClientWrapper, instance(mockDialect), initialHost, clusterInstanceTemplate);

    expect(result).toBeTruthy();
    expect(result.length).toEqual(2);
    expect(result[1].role).toEqual(HostRole.WRITER); // Writer should be at the bottom.
    expect(result[0].role).toEqual(HostRole.READER);
  });

  it("testCreateHost_withAllParameters", () => {
    const topologyUtils = getTopologyUtils();
    const timestamp = Date.now();

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const instanceTemplate = createHost({
      host: "?.cluster-endpoint",
      port: 3306,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const result = topologyUtils.createHost("id-1", "instance-1", true, 100, timestamp, initialHost, instanceTemplate);

    expect(result).toBeTruthy();
    expect(result.host).toEqual("instance-1.cluster-endpoint");
    expect(result.port).toEqual(3306);
    expect(result.role).toEqual(HostRole.WRITER);
    expect(result.availability).toEqual(HostAvailability.AVAILABLE);
    expect(result.weight).toEqual(100);
    expect(result.lastUpdateTime).toEqual(timestamp);
    expect(result.hostId).toEqual("id-1");
  });

  it("testCreateHost_withMissingInstanceName", () => {
    const topologyUtils = getTopologyUtils();
    const timestamp = Date.now();

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const instanceTemplate = createHost({
      host: "?.cluster-endpoint",
      port: 3306,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const result = topologyUtils.createHost("id-1", "", false, 50, timestamp, initialHost, instanceTemplate);

    expect(result).toBeTruthy();
    expect(result.host).toEqual("?.cluster-endpoint");
    expect(result.role).toEqual(HostRole.READER);
  });

  it("testCreateHosts_withMultipleResults", () => {
    const topologyUtils = getTopologyUtils();
    const timestamp = Date.now();

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const clusterInstanceTemplate = createHost({
      host: "?.cluster-endpoint",
      port: 3306,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const queryResults: TopologyQueryResult[] = [
      new TopologyQueryResult("instance-1", true, 100, timestamp, 3306, "id-1"),
      new TopologyQueryResult("instance-2", false, 50, timestamp, 3306, "id-2"),
      new TopologyQueryResult("instance-3", false, 75, timestamp, 3306, "id-3")
    ];

    const result = topologyUtils.createHosts(queryResults, initialHost, clusterInstanceTemplate);

    expect(result).toBeTruthy();
    expect(result.length).toEqual(3);
    expect(result[0].host).toEqual("instance-1.cluster-endpoint");
    expect(result[0].role).toEqual(HostRole.WRITER);
    expect(result[1].host).toEqual("instance-2.cluster-endpoint");
    expect(result[1].role).toEqual(HostRole.READER);
    expect(result[2].host).toEqual("instance-3.cluster-endpoint");
    expect(result[2].role).toEqual(HostRole.READER);
  });

  it("testCreateHosts_withEndpointInQueryResult", () => {
    const topologyUtils = getTopologyUtils();
    const timestamp = Date.now();

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const clusterInstanceTemplate = createHost({
      host: "?.cluster-endpoint",
      port: 3306,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const queryResults: TopologyQueryResult[] = [new TopologyQueryResult("instance-1", true, 100, timestamp, 3306, "id-1", "custom-endpoint.com")];

    const result = topologyUtils.createHosts(queryResults, initialHost, clusterInstanceTemplate);

    expect(result).toBeTruthy();
    expect(result.length).toEqual(1);
    expect(result[0].host).toEqual("custom-endpoint.com");
  });

  it("testCreateHosts_withMissingPort", () => {
    const topologyUtils = getTopologyUtils();
    const timestamp = Date.now();

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const clusterInstanceTemplate = createHost({
      host: "?.cluster-endpoint",
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const queryResults: TopologyQueryResult[] = [new TopologyQueryResult("instance-1", true, 100, timestamp, undefined, "id-1")];

    const result = topologyUtils.createHosts(queryResults, initialHost, clusterInstanceTemplate);

    expect(result).toBeTruthy();
    expect(result.length).toEqual(1);
    expect(result[0].port).toEqual(5432);
  });

  it("testVerifyWriter_withSingleWriter", async () => {
    const topologyUtils = getTopologyUtils();

    const writer = createHost({
      host: "writer-host",
      port: 5432,
      role: HostRole.WRITER,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const reader = createHost({
      host: "reader-host",
      port: 5432,
      role: HostRole.READER,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const allHosts = [writer, reader];
    const result = await topologyUtils["verifyWriter"](allHosts);

    expect(result).toBeTruthy();
    expect(result.length).toEqual(2);
    expect(result.filter((h) => h.role === HostRole.WRITER).length).toEqual(1);
  });

  it("testVerifyWriter_withMultipleWriters_selectsMostRecent", async () => {
    const topologyUtils = getTopologyUtils();
    const oldTimestamp = Date.now() - 10000;
    const newTimestamp = Date.now();

    const oldWriter = createHost({
      host: "old-writer",
      port: 5432,
      role: HostRole.WRITER,
      lastUpdateTime: oldTimestamp,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const newWriter = createHost({
      host: "new-writer",
      port: 5432,
      role: HostRole.WRITER,
      lastUpdateTime: newTimestamp,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const reader = createHost({
      host: "reader-host",
      port: 5432,
      role: HostRole.READER,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const allHosts = [oldWriter, newWriter, reader];
    const result = await topologyUtils["verifyWriter"](allHosts);

    expect(result).toBeTruthy();
    expect(result.length).toEqual(2);
    expect(result.filter((h) => h.role === HostRole.WRITER).length).toEqual(1);
    expect(result.find((h) => h.role === HostRole.WRITER)?.host).toEqual("new-writer");
  });

  it("testVerifyWriter_withNoWriter_returnsNull", async () => {
    const topologyUtils = getTopologyUtils();

    const reader1 = createHost({
      host: "reader-1",
      port: 5432,
      role: HostRole.READER,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const reader2 = createHost({
      host: "reader-2",
      port: 5432,
      role: HostRole.READER,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const allHosts = [reader1, reader2];
    const result = await topologyUtils["verifyWriter"](allHosts);

    expect(result).toBeNull();
  });

  it("testIsWriterInstance_returnsTrue", async () => {
    const topologyUtils = getTopologyUtils();

    when(mockDialect.getWriterId(anything())).thenResolve("writer-id");

    const result = await topologyUtils.isWriterInstance(mockClientWrapper);

    expect(result).toBeTruthy();
  });

  it("testIsWriterInstance_returnsFalse", async () => {
    const topologyUtils = getTopologyUtils();

    when(mockDialect.getWriterId(anything())).thenResolve(null);

    const result = await topologyUtils.isWriterInstance(mockClientWrapper);

    expect(result).toBeFalsy();
  });

  it("testCreateHosts_withDuplicateHosts_keepsMostRecent", () => {
    const topologyUtils = getTopologyUtils();
    const oldTimestamp = Date.now() - 10000;
    const newTimestamp = Date.now();

    const initialHost = createHost({
      host: "initial-host",
      port: 5432,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const clusterInstanceTemplate = createHost({
      host: "?.cluster-endpoint",
      port: 3306,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    });

    const queryResults: TopologyQueryResult[] = [
      new TopologyQueryResult("instance-1", false, 100, oldTimestamp, 3306, "id-1"),
      new TopologyQueryResult("instance-1", false, 50, newTimestamp, 3306, "id-1-updated")
    ];

    const result = topologyUtils.createHosts(queryResults, initialHost, clusterInstanceTemplate);

    expect(result).toBeTruthy();
    expect(result.length).toEqual(1);
    expect(result[0].host).toEqual("instance-1.cluster-endpoint");
    expect(result[0].lastUpdateTime).toEqual(newTimestamp);
    expect(result[0].hostId).toEqual("id-1-updated");
  });
});
