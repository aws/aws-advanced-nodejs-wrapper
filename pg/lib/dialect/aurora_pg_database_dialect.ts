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
import { TopologyAwareDatabaseDialect } from "../../../common/lib/database_dialect/topology_aware_database_dialect";
import { HostInfo, HostRole } from "../../../common/lib";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { LimitlessDatabaseDialect } from "../../../common/lib/database_dialect/limitless_database_dialect";
import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { MonitoringRdsHostListProvider } from "../../../common/lib/host_list_provider/monitoring/monitoring_host_list_provider";
import { PluginService } from "../../../common/lib/plugin_service";
import { BlueGreenDialect, BlueGreenResult } from "../../../common/lib/database_dialect/blue_green_dialect";
import { TopologyQueryResult, TopologyUtils } from "../../../common/lib/host_list_provider/topology_utils";
import { RdsTopologyUtils } from "../../../common/lib/host_list_provider/aurora_topology_utils";

export class AuroraPgDatabaseDialect extends PgDatabaseDialect implements TopologyAwareDatabaseDialect, LimitlessDatabaseDialect, BlueGreenDialect {
  private static readonly VERSION = process.env.npm_package_version;
  private static readonly TOPOLOGY_QUERY: string =
    "SELECT server_id, CASE WHEN SESSION_ID OPERATOR(pg_catalog.=) 'MASTER_SESSION_ID' THEN TRUE ELSE FALSE END AS is_writer, " +
    "CPU, COALESCE(REPLICA_LAG_IN_MSEC, 0) AS lag, LAST_UPDATE_TIMESTAMP " +
    "FROM pg_catalog.aurora_replica_status() " +
    // filter out nodes that haven't been updated in the last 5 minutes
    "WHERE EXTRACT(EPOCH FROM(pg_catalog.NOW() OPERATOR(pg_catalog.-) LAST_UPDATE_TIMESTAMP)) OPERATOR(pg_catalog.<=) 300 OR SESSION_ID OPERATOR(pg_catalog.=) 'MASTER_SESSION_ID' " +
    "OR LAST_UPDATE_TIMESTAMP IS NULL";
  private static readonly EXTENSIONS_SQL: string =
    "SELECT (setting LIKE '%aurora_stat_utils%') AS aurora_stat_utils FROM pg_catalog.pg_settings WHERE name OPERATOR(pg_catalog.=) 'rds.extensions'";
  private static readonly HOST_ID_QUERY: string = "SELECT pg_catalog.aurora_db_instance_identifier() as host";
  protected static readonly INSTANCE_ID_QUERY: string =
    "SELECT pg_catalog.aurora_db_instance_identifier() as instance_id, pg_catalog.aurora_db_instance_identifier() as instance_name";
  private static readonly IS_READER_QUERY: string = "SELECT pg_catalog.pg_is_in_recovery() as is_reader";
  private static readonly IS_WRITER_QUERY: string =
    "SELECT server_id " +
    "FROM pg_catalog.aurora_replica_status() " +
    "WHERE SESSION_ID OPERATOR(pg_catalog.=) 'MASTER_SESSION_ID' AND SERVER_ID OPERATOR(pg_catalog.=) pg_catalog.aurora_db_instance_identifier()";

  private static readonly BG_STATUS_QUERY: string = `SELECT * FROM pg_catalog.get_blue_green_fast_switchover_metadata('aws_advanced_nodejs_wrapper-${AuroraPgDatabaseDialect.VERSION}')`;

  private static readonly TOPOLOGY_TABLE_EXIST_QUERY: string = "SELECT pg_catalog.'get_blue_green_fast_switchover_metadata'::regproc";

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    const topologyUtils: TopologyUtils = new RdsTopologyUtils(this, hostListProviderService.getHostInfoBuilder());
    if (WrapperProperties.PLUGINS.get(props).includes("failover2")) {
      return new MonitoringRdsHostListProvider(
        props,
        originalUrl,
        topologyUtils,
        hostListProviderService,
        <PluginService>(<unknown>hostListProviderService)
      );
    }
    return new RdsHostListProvider(props, originalUrl, topologyUtils, hostListProviderService);
  }

  async queryForTopology(targetClient: ClientWrapper): Promise<TopologyQueryResult[]> {
    const res = await targetClient.query(AuroraPgDatabaseDialect.TOPOLOGY_QUERY);
    const results: TopologyQueryResult[] = [];
    const rows: any[] = res.rows;
    rows.forEach((row) => {
      // According to the topology query the result set
      // should contain 4 columns: node ID, 1/0 (writer/reader), CPU utilization, node lag in time.
      const hostName: string = row["server_id"];
      const isWriter: boolean = row["is_writer"];
      const cpuUtilization: number = row["cpu"];
      const hostLag: number = row["lag"];
      const lastUpdateTime: number = row["last_update_timestamp"] ? Date.parse(row["last_update_timestamp"]) : Date.now();
      const host: TopologyQueryResult = new TopologyQueryResult(
        hostName,
        isWriter,
        Math.round(hostLag) * 100 + Math.round(cpuUtilization),
        lastUpdateTime
      );
      results.push(host);
    });
    return results;
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
    } catch (e: any) {
      if (e.message.includes("Cannot read properties of undefined")) {
        // Query returned no result, targetClient is not connected to a writer.
        return null;
      }
      throw e;
    }
  }

  async getInstanceId(targetClient: ClientWrapper): Promise<[string, string]> {
    const res = await targetClient.query(AuroraPgDatabaseDialect.INSTANCE_ID_QUERY);
    try {
      const instance_id: string = res.rows[0]["instance_id"];
      const instance_name: string = res.rows[0]["instance_name"];
      return [instance_id, instance_name];
    } catch (e: any) {
      if (e.message.includes("Cannot read properties of undefined")) {
        // Query returned no result, targetClient is not connected to a writer.
        return ["", ""];
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

  async isBlueGreenStatusAvailable(clientWrapper: ClientWrapper): Promise<boolean> {
    try {
      const result = await clientWrapper.query(AuroraPgDatabaseDialect.TOPOLOGY_TABLE_EXIST_QUERY);
      return !!result.rows[0];
    } catch {
      return false;
    }
  }

  async getBlueGreenStatus(clientWrapper: ClientWrapper): Promise<BlueGreenResult[] | null> {
    const results: BlueGreenResult[] = [];
    const result = await clientWrapper.query(AuroraPgDatabaseDialect.BG_STATUS_QUERY);
    for (const row of result.rows) {
      results.push(new BlueGreenResult(row.version, row.endpoint, row.port, row.role, row.status));
    }
    return results.length > 0 ? results : null;
  }
}
