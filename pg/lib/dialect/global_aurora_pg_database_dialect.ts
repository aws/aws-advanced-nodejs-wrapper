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

import { AuroraPgDatabaseDialect } from "./aurora_pg_database_dialect";
import { GlobalAuroraTopologyDialect } from "../../../common/lib/database_dialect/topology_aware_database_dialect";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { TopologyQueryResult } from "../../../common/lib/host_list_provider/topology_utils";

export class GlobalAuroraPgDatabaseDialect extends AuroraPgDatabaseDialect implements GlobalAuroraTopologyDialect {
  private static readonly GLOBAL_STATUS_FUNC_EXISTS_QUERY = "select 'aurora_global_db_status'::regproc";

  private static readonly GLOBAL_INSTANCE_STATUS_FUNC_EXISTS_QUERY = "select 'aurora_global_db_instance_status'::regproc";

  private static readonly GLOBAL_TOPOLOGY_QUERY =
    "SELECT SERVER_ID, CASE WHEN SESSION_ID = 'MASTER_SESSION_ID' THEN TRUE ELSE FALSE END AS IS_WRITER, " +
    "VISIBILITY_LAG_IN_MSEC, AWS_REGION " +
    "FROM aurora_global_db_instance_status()";

  private static readonly REGION_COUNT_QUERY = "SELECT count(1) FROM aurora_global_db_status()";

  private static readonly REGION_BY_INSTANCE_ID_QUERY = "SELECT AWS_REGION FROM aurora_global_db_instance_status() WHERE SERVER_ID = $1";

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    try {
      // First check if aurora_stat_utils extension is available
      const extensionsResult = await targetClient.query(
        "SELECT (setting LIKE '%aurora_stat_utils%') AS aurora_stat_utils FROM pg_catalog.pg_settings WHERE name OPERATOR(pg_catalog.=) 'rds.extensions'"
      );

      if (!extensionsResult.rows?.[0]) {
        return false;
      }

      const auroraUtils = extensionsResult.rows[0]["aurora_stat_utils"];
      if (!auroraUtils) {
        return false;
      }

      // Check if both global status functions exist
      const statusResult = await targetClient.query(GlobalAuroraPgDatabaseDialect.GLOBAL_STATUS_FUNC_EXISTS_QUERY);
      if (!statusResult.rows?.[0]) {
        return false;
      }

      const instanceStatusResult = await targetClient.query(GlobalAuroraPgDatabaseDialect.GLOBAL_INSTANCE_STATUS_FUNC_EXISTS_QUERY);
      if (!instanceStatusResult.rows?.[0]) {
        return false;
      }

      // Check if there are multiple regions
      const regionCountResult = await targetClient.query(GlobalAuroraPgDatabaseDialect.REGION_COUNT_QUERY);
      if (!regionCountResult.rows?.[0]) {
        return false;
      }

      const awsRegionCount = regionCountResult.rows[0]["count"];
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
    const res = await targetClient.query(GlobalAuroraPgDatabaseDialect.GLOBAL_TOPOLOGY_QUERY);
    const hosts: TopologyQueryResult[] = [];
    const rows: any[] = res.rows;
    rows.forEach((row) => {
      const hostName: string = row["server_id"];
      const isWriter: boolean = row["is_writer"];
      const hostLag: number = row["visibility_lag_in_msec"] ?? 0;
      const awsRegion: string = row["aws_region"];
      const host: TopologyQueryResult = new TopologyQueryResult({
        host: hostName,
        isWriter: isWriter,
        weight: Math.round(hostLag) * 100,
        awsRegion: awsRegion
      });
      hosts.push(host);
    });
    return hosts;
  }

  async getRegionByInstanceId(targetClient: ClientWrapper, instanceId: string): Promise<string | null> {
    try {
      const result = await targetClient.query(GlobalAuroraPgDatabaseDialect.REGION_BY_INSTANCE_ID_QUERY, [instanceId]);
      if (!result.rows?.[0]) {
        return null;
      }
      return result.rows[0]["aws_region"] ?? null;
    } catch {
      return null;
    }
  }
}
