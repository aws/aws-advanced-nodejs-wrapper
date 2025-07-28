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

import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { PluginServiceManagerContainer } from "../../common/lib/plugin_service_manager_container";
import { mock } from "ts-mockito";
import { AwsClient } from "../../common/lib/aws_client";
import { DatabaseDialect, DatabaseType } from "../../common/lib/database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../../common/lib/database_dialect/database_dialect_codes";
import { MySQLDatabaseDialect } from "../../mysql/lib/dialect/mysql_database_dialect";
import { RdsMySQLDatabaseDialect } from "../../mysql/lib/dialect/rds_mysql_database_dialect";
import { AuroraMySQLDatabaseDialect } from "../../mysql/lib/dialect/aurora_mysql_database_dialect";
import { RdsMultiAZClusterMySQLDatabaseDialect } from "../../mysql/lib/dialect/rds_multi_az_mysql_database_dialect";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { AllowedAndBlockedHosts } from "../../common/lib/AllowedAndBlockedHosts";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { HostInfo } from "../../common/lib/host_info";

function createHost(host: string) {
  return new HostInfoBuilder({
    host: host,
    hostId: host,
    port: 1234,
    hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
  }).build();
}

const host1 = createHost("host-1");
const host2 = createHost("host-2");
const host3 = createHost("host-3");
const host4 = createHost("host-4");
const allHosts = [host1, host2, host3, host4];

class TestPluginService extends PluginServiceImpl {
  setHosts(hosts: HostInfo[]) {
    this.hosts = hosts;
  }
}

const knownDialectsByCode: Map<string, DatabaseDialect> = new Map([
  [DatabaseDialectCodes.MYSQL, new MySQLDatabaseDialect()],
  [DatabaseDialectCodes.RDS_MYSQL, new RdsMySQLDatabaseDialect()],
  [DatabaseDialectCodes.AURORA_MYSQL, new AuroraMySQLDatabaseDialect()],
  [DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL, new RdsMultiAZClusterMySQLDatabaseDialect()]
]);

const mockAwsClient: AwsClient = mock(AwsClient);
let pluginService: TestPluginService;

describe("testCustomEndpoint", () => {
  beforeEach(() => {
    pluginService = new TestPluginService(
      new PluginServiceManagerContainer(),
      mockAwsClient,
      DatabaseType.MYSQL,
      knownDialectsByCode,
      new Map(),
      new MySQL2DriverDialect()
    );
  });

  it("test get hosts - blocked hosts empty", async () => {
    pluginService.setHosts(allHosts);
    const allowedHosts = new Set<string>(["host-1", "host-2"]);
    const blockedHosts = new Set<string>();
    const allowedAndBlockedHosts = new AllowedAndBlockedHosts(allowedHosts, blockedHosts);
    pluginService.setAllowedAndBlockedHosts(allowedAndBlockedHosts);
    const hosts = pluginService.getHosts();
    expect(hosts.length).toBe(2);
    expect(hosts.includes(host1)).toBeTruthy();
    expect(hosts.includes(host2)).toBeTruthy();
  });

  it("test get hosts - allowed hosts empty", async () => {
    pluginService.setHosts(allHosts);
    const allowedHosts = new Set<string>();
    const blockedHosts = new Set<string>(["host-1", "host-2"]);
    const allowedAndBlockedHosts = new AllowedAndBlockedHosts(allowedHosts, blockedHosts);
    pluginService.setAllowedAndBlockedHosts(allowedAndBlockedHosts);
    const hosts = pluginService.getHosts();
    expect(hosts.length).toBe(2);
    expect(hosts.includes(host3)).toBeTruthy();
    expect(hosts.includes(host4)).toBeTruthy();
  });

  it("test get hosts - allowed and blocked hosts not empty", async () => {
    pluginService.setHosts(allHosts);
    const allowedHosts = new Set<string>(["host-1", "host-2"]);
    const blockedHosts = new Set<string>(["host-3", "host-4"]);
    const allowedAndBlockedHosts = new AllowedAndBlockedHosts(allowedHosts, blockedHosts);
    pluginService.setAllowedAndBlockedHosts(allowedAndBlockedHosts);
    const hosts = pluginService.getHosts();
    expect(hosts.length).toBe(2);
    expect(hosts.includes(host1)).toBeTruthy();
    expect(hosts.includes(host2)).toBeTruthy();
  });
});
