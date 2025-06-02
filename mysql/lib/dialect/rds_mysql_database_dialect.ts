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
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { BlueGreenDialect, BlueGreenResult } from "../../../common/lib/database_dialect/blue_green_dialect";

export class RdsMySQLDatabaseDialect extends MySQLDatabaseDialect implements BlueGreenDialect {
  private static readonly BG_STATUS_QUERY: string = "SELECT * FROM mysql.rds_topology";

  private static readonly TOPOLOGY_TABLE_EXIST_QUERY: string =
    "SELECT 1 AS tmp FROM information_schema.tables WHERE" + " table_schema = 'mysql' AND table_name = 'rds_topology'";

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.AURORA_MYSQL, DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL];
  }

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    if (await super.isDialect(targetClient)) {
      // MysqlDialect and RdsMysqlDialect use the same server version query to determine the dialect.
      // The `SHOW VARIABLES LIKE 'version_comment'` either outputs
      // | Variable_name   | value                        |
      // |-----------------|------------------------------|
      // | version_comment | MySQL Community Server (GPL) |
      // for community Mysql, or
      // | Variable_name   | value               |
      // |-----------------|---------------------|
      // | version_comment | Source distribution |
      // for RDS MySQL. If super.isDialect returns true there is no need to check for RdsMysqlDialect.
      return false;
    }

    return await targetClient
      .query(this.getServerVersionQuery())
      .then(([rows]: any) => {
        return rows[0]["Value"].toLowerCase().includes("source distribution");
      })
      .catch(() => {
        return false;
      });
  }

  getDialectName(): string {
    return this.dialectName;
  }

  isBlueGreenStatusAvailable(clientWrapper: ClientWrapper): Promise<boolean> {
    return Promise.resolve(false);
  }

  async getBlueGreenStatus(clientWrapper: ClientWrapper): Promise<BlueGreenResult[] | null> {
    try {
      const results: BlueGreenResult[] = [];
      const [rows] = await clientWrapper.query(RdsMySQLDatabaseDialect.BG_STATUS_QUERY);
      for (const row of rows) {
        results.push(new BlueGreenResult(row.version, row.endpoint, row.port, row.role, row.status));
      }
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }
}
