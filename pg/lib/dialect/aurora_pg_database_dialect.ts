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

import { PgDatabaseDialect } from "./pg_database_dialect";
import { HostListProviderService } from "../../../common/lib/host_list_provider_service";
import { HostListProvider } from "../../../common/lib/host_list_provider/host_list_provider";
import { RdsHostListProvider } from "../../../common/lib/host_list_provider/rds_host_list_provider";
import { TopologyAwareDatabaseDialect } from "../../../common/lib/topology_aware_database_dialect";
import { HostInfo } from "../../../common/lib/host_info";
import { HostRole } from "../../../common/lib/host_role";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { LimitlessDatabaseDialect } from "../../../common/lib/database_dialect/limitless_database_dialect";
import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { MonitoringRdsHostListProvider } from "../../../common/lib/host_list_provider/monitoring/monitoring_host_list_provider";
import { PluginService } from "../../../common/lib/plugin_service";

export class AuroraPgDatabaseDialect extends PgDatabaseDialect implements TopologyAwareDatabaseDialect, LimitlessDatabaseDialect {
  private static readonly TOPOLOGY_QUERY: string =
    "SELECT server_id, CASE WHEN SESSION_ID = 'MASTER_SESSION_ID' THEN TRUE ELSE FALSE END AS is_writer, " +
    "CPU, COALESCE(REPLICA_LAG_IN_MSEC, 0) AS lag, LAST_UPDATE_TIMESTAMP " +
    "FROM aurora_replica_status() " +
    // filter out nodes that haven't been updated in the last 5 minutes
    "WHERE EXTRACT(EPOCH FROM(NOW() - LAST_UPDATE_TIMESTAMP)) <= 300 OR SESSION_ID = 'MASTER_SESSION_ID' " +
    "OR LAST_UPDATE_TIMESTAMP IS NULL";
  private static readonly EXTENSIONS_SQL: string =
    "SELECT (setting LIKE '%aurora_stat_utils%') AS aurora_stat_utils FROM pg_settings WHERE name='rds.extensions'";
  private static readonly HOST_ID_QUERY: string = "SELECT aurora_db_instance_identifier() as host";
  private static readonly IS_READER_QUERY: string = "SELECT pg_is_in_recovery() as is_reader";
  private static readonly IS_WRITER_QUERY: string =
    "SELECT server_id " + "FROM aurora_replica_status() " + "WHERE SESSION_ID = 'MASTER_SESSION_ID' AND SERVER_ID = aurora_db_instance_identifier()";

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    if (WrapperProperties.PLUGINS.get(props).includes("failover2")) {
      return new MonitoringRdsHostListProvider(props, originalUrl, hostListProviderService, <PluginService>hostListProviderService);
    }
    return new RdsHostListProvider(props, originalUrl, hostListProviderService);
  }

  async queryForTopology(targetClient: ClientWrapper, hostListProvider: HostListProvider): Promise<HostInfo[]> {
    const res = await targetClient.query(AuroraPgDatabaseDialect.TOPOLOGY_QUERY);
    const hosts: HostInfo[] = [];
    const rows: any[] = res.rows;
    rows.forEach((row) => {
      // According to the topology query the result set
      // should contain 4 columns: node ID, 1/0 (writer/reader), CPU utilization, node lag in time.
      const hostName: string = row["server_id"];
      const isWriter: boolean = row["is_writer"];
      const cpuUtilization: number = row["cpu"];
      const hostLag: number = row["lag"];
      const lastUpdateTime: number = row["last_update_timestamp"] ? Date.parse(row["last_update_timestamp"]) : Date.now();
      const host: HostInfo = hostListProvider.createHost(hostName, isWriter, Math.round(hostLag) * 100 + Math.round(cpuUtilization), lastUpdateTime);
      hosts.push(host);
    });
    return hosts;
  }

  async identifyConnection(targetClient: ClientWrapper): Promise<string> {
    const res = await targetClient.query(AuroraPgDatabaseDialect.HOST_ID_QUERY);
    return Promise.resolve(res.rows[0]["host"] ?? "");
  }

  async getHostRole(targetClient: ClientWrapper): Promise<HostRole> {
    const res = await targetClient.query(AuroraPgDatabaseDialect.IS_READER_QUERY);
    return Promise.resolve(res.rows[0]["is_reader"] === true ? HostRole.READER : HostRole.WRITER);
  }

  async getWriterId(targetClient: ClientWrapper): Promise<string | null> {
    const res = await targetClient.query(AuroraPgDatabaseDialect.IS_WRITER_QUERY);
    try {
      const writerId: string = res.rows[0]["server_id"];
      return writerId ? writerId : null;
    } catch (e) {
      if (e.message.includes("Cannot read properties of undefined")) {
        // Query returned no result, targetClient is not connected to a writer.
        return null;
      }
      throw e;
    }
  }

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    if (!(await super.isDialect(targetClient))) {
      return false;
    }

    return await targetClient
      .query(AuroraPgDatabaseDialect.EXTENSIONS_SQL)
      .then((result: any) => {
        return result.rows[0]["aurora_stat_utils"];
      })
      .catch(() => {
        return false;
      });
  }

  getDialectName() {
    return this.dialectName;
  }

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.RDS_MULTI_AZ_PG];
  }

  getLimitlessRoutersQuery(): string {
    return "select router_endpoint, load from aurora_limitless_router_endpoints()";
  }
}
