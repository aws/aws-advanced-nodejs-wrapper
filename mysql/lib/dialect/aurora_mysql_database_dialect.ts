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

import { MySQLDatabaseDialect } from "./mysql_database_dialect";
import { HostListProviderService } from "../../../common/lib/host_list_provider_service";
import { HostListProvider } from "../../../common/lib/host_list_provider/host_list_provider";
import { RdsHostListProvider } from "../../../common/lib/host_list_provider/rds_host_list_provider";
import { AwsClient } from "../../../common/lib/aws_client";
import { HostInfo } from "../../../common/lib/host_info";
import { TopologyAwareDatabaseDialect } from "../../../common/lib/topology_aware_database_dialect";
import { HostRole } from "../../../common/lib/host_role";

export class AuroraMySQLDatabaseDialect extends MySQLDatabaseDialect implements TopologyAwareDatabaseDialect {
  private static readonly TOPOLOGY_QUERY: string =
    "SELECT server_id, CASE WHEN SESSION_ID = 'MASTER_SESSION_ID' THEN TRUE ELSE FALSE END as is_writer, " +
    "cpu, REPLICA_LAG_IN_MILLISECONDS as 'lag', LAST_UPDATE_TIMESTAMP as last_update_timestamp " +
    "FROM information_schema.replica_host_status " +
    // filter out nodes that haven't been updated in the last 5 minutes
    "WHERE time_to_sec(timediff(now(), LAST_UPDATE_TIMESTAMP)) <= 300 OR SESSION_ID = 'MASTER_SESSION_ID' ";
  private static readonly HOST_ID_QUERY: string = "SELECT @@aurora_server_id as host";
  private static readonly IS_READER_QUERY: string = "SELECT @@innodb_read_only as is_reader";
  private static readonly AURORA_VERSION_QUERY = "SHOW VARIABLES LIKE 'aurora_version'";

  constructor() {
    super();
    this.dialectName = "AuroraMySQLDatabaseDialect";
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    return new RdsHostListProvider(props, originalUrl, hostListProviderService);
  }

  async queryForTopology(targetClient: any, hostListProvider: HostListProvider): Promise<HostInfo[]> {
    const res = await targetClient.promise().query(AuroraMySQLDatabaseDialect.TOPOLOGY_QUERY);
    const hosts: HostInfo[] = [];
    const rows: any[] = res[0];
    rows.forEach((row) => {
      // According to the topology query the result set
      // should contain 4 columns: node ID, 1/0 (writer/reader), CPU utilization, node lag in time.
      const hostName: string = row["server_id"];
      const isWriter: boolean = row["is_writer"];
      const cpuUtilization: number = row["cpu"];
      const nodeLag: number = row["lag"];
      const lastUpdateTime: number = row["last_update_timestamp"] ? Date.parse(row["last_update_timestamp"]) : Date.now();
      const host: HostInfo = hostListProvider.createHost(hostName, isWriter, Math.round(nodeLag) * 100 + Math.round(cpuUtilization), lastUpdateTime);
      hosts.push(host);
    });
    return hosts;
  }

  async identifyConnection(client: AwsClient, props: Map<string, any>): Promise<string> {
    const res = await client.executeQuery(props, AuroraMySQLDatabaseDialect.HOST_ID_QUERY);
    return res[0]["host"];
  }

  async getHostRole(client: AwsClient, props: Map<string, any>): Promise<HostRole> {
    const res = await client.executeQuery(props, AuroraMySQLDatabaseDialect.IS_READER_QUERY);
    return Promise.resolve(res[0]["is_reader"] === "true" ? HostRole.READER : HostRole.WRITER);
  }

  async isDialect(targetClient: any): Promise<boolean> {
    return targetClient
      .promise()
      .query(AuroraMySQLDatabaseDialect.AURORA_VERSION_QUERY)
      .then(([rows]: any) => {
        return !!rows[0]["Value"];
      })
      .catch(() => {
        return false;
      });
  }

  getDialectName(): string {
    return this.dialectName;
  }
}
