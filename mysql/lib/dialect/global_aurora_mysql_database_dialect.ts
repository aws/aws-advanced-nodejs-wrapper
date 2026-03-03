/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AuroraMySQLDatabaseDialect } from "./aurora_mysql_database_dialect";
import { GlobalAuroraTopologyDialect } from "../../../common/lib/database_dialect/topology_aware_database_dialect";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { TopologyQueryResult } from "../../../common/lib/host_list_provider/topology_utils";

export class GlobalAuroraMySQLDatabaseDialect extends AuroraMySQLDatabaseDialect implements GlobalAuroraTopologyDialect {
  private static readonly GLOBAL_STATUS_TABLE_EXISTS_QUERY =
    "SELECT 1 AS tmp FROM information_schema.tables WHERE" +
    " upper(table_schema) = 'INFORMATION_SCHEMA' AND upper(table_name) = 'AURORA_GLOBAL_DB_STATUS'";

  private static readonly GLOBAL_INSTANCE_STATUS_EXISTS_QUERY =
    "SELECT 1 AS tmp FROM information_schema.tables WHERE" +
    " upper(table_schema) = 'INFORMATION_SCHEMA' AND upper(table_name) = 'AURORA_GLOBAL_DB_INSTANCE_STATUS'";

  private static readonly GLOBAL_TOPOLOGY_QUERY =
    "SELECT SERVER_ID, CASE WHEN SESSION_ID = 'MASTER_SESSION_ID' THEN TRUE ELSE FALSE END AS IS_WRITER, " +
    "VISIBILITY_LAG_IN_MSEC, AWS_REGION " +
    "FROM information_schema.aurora_global_db_instance_status";

  private static readonly REGION_COUNT_QUERY = "SELECT count(1) FROM information_schema.aurora_global_db_status";

  private static readonly REGION_BY_INSTANCE_ID_QUERY =
    "SELECT AWS_REGION FROM information_schema.aurora_global_db_instance_status WHERE SERVER_ID = ?";

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    try {
      // Check if both global status tables exist
      const [statusRows] = await targetClient.query(GlobalAuroraMySQLDatabaseDialect.GLOBAL_STATUS_TABLE_EXISTS_QUERY);
      if (!statusRows?.[0]) {
        return false;
      }

      const [instanceStatusRows] = await targetClient.query(GlobalAuroraMySQLDatabaseDialect.GLOBAL_INSTANCE_STATUS_EXISTS_QUERY);
      if (!instanceStatusRows?.[0]) {
        return false;
      }

      // Check if there are multiple regions
      const [regionCountRows] = await targetClient.query(GlobalAuroraMySQLDatabaseDialect.REGION_COUNT_QUERY);
      if (!regionCountRows?.[0]) {
        return false;
      }

      const awsRegionCount = regionCountRows[0]["count(1)"];
      return awsRegionCount > 1;
    } catch {
      return false;
    }
  }

  getDialectUpdateCandidates(): string[] {
    return [];
  }

  // TODO: implement GetHostListProvider once GDBHostListProvider is implemented

  async queryForTopology(targetClient: ClientWrapper): Promise<TopologyQueryResult[]> {
    const res = await targetClient.query(GlobalAuroraMySQLDatabaseDialect.GLOBAL_TOPOLOGY_QUERY);
    const results: TopologyQueryResult[] = [];
    const rows: any[] = res[0];
    rows.forEach((row) => {
      const hostName: string = row["server_id"];
      const isWriter: boolean = row["is_writer"];
      const hostLag: number = row["visibility_lag_in_msec"] ?? 0; // visibility_lag_in_msec is nullable.
      const awsRegion: string = row["aws_region"];

      const host: TopologyQueryResult = new TopologyQueryResult({
        host: hostName,
        isWriter: isWriter,
        weight: Math.round(hostLag) * 100,
        awsRegion: awsRegion
      });
      results.push(host);
    });
    return results;
  }

  async getRegionByInstanceId(targetClient: ClientWrapper, instanceId: string): Promise<string | null> {
    try {
      const [rows] = await targetClient.query(GlobalAuroraMySQLDatabaseDialect.REGION_BY_INSTANCE_ID_QUERY, [instanceId]);
      if (!rows?.[0]) {
        return null;
      }
      return rows[0]["aws_region"] ?? null;
    } catch {
      return null;
    }
  }
}
