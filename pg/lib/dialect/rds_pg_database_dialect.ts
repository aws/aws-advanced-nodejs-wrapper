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
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { BlueGreenDialect, BlueGreenResult } from "../../../common/lib/database_dialect/blue_green_dialect";

export class RdsPgDatabaseDialect extends PgDatabaseDialect implements BlueGreenDialect {
  private static readonly VERSION = process.env.npm_package_version;

  private static readonly EXTENSIONS_SQL: string =
    "SELECT (setting LIKE '%rds_tools%') AS rds_tools, (setting LIKE '%aurora_stat_utils%') AS aurora_stat_utils " +
    "FROM pg_settings WHERE name='rds.extensions'";

  private static readonly BG_STATUS_QUERY: string = `SELECT * FROM rds_tools.show_topology('aws_advanced_nodejs_wrapper-${RdsPgDatabaseDialect.VERSION}')`;

  private static readonly TOPOLOGY_TABLE_EXIST_QUERY: string = "SELECT 'rds_tools.show_topology'::regproc";

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.RDS_MULTI_AZ_PG, DatabaseDialectCodes.AURORA_PG];
  }

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    if (!(await super.isDialect(targetClient))) {
      return false;
    }

    return await targetClient
      .query(RdsPgDatabaseDialect.EXTENSIONS_SQL)
      .then((result: any) => {
        const rdsTools = result.rows[0]["rds_tools"];
        const auroraStatUtils = result.rows[0]["aurora_stat_utils"];
        return rdsTools && !auroraStatUtils;
      })
      .catch(() => {
        return false;
      });
  }

  getDialectName(): string {
    return this.dialectName;
  }

  async isBlueGreenStatusAvailable(clientWrapper: ClientWrapper): Promise<boolean> {
    try {
      const result = await clientWrapper.query(RdsPgDatabaseDialect.TOPOLOGY_TABLE_EXIST_QUERY);
      return !!result.rows[0];
    } catch {
      return false;
    }
  }

  async getBlueGreenStatus(clientWrapper: ClientWrapper): Promise<BlueGreenResult[] | null> {
    try {
      const results: BlueGreenResult[] = [];
      const result = await clientWrapper.query(RdsPgDatabaseDialect.BG_STATUS_QUERY);
      for (const row of result.rows) {
        results.push(new BlueGreenResult(row.version, row.endpoint, row.port, row.role, row.status));
      }
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }
}
