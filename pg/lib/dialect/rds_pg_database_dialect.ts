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

export class RdsPgDatabaseDialect extends PgDatabaseDialect {
  private static readonly EXTENSIONS_SQL: string =
    "SELECT (setting LIKE '%rds_tools%') AS rds_tools, (setting LIKE '%aurora_stat_utils%') AS aurora_stat_utils " +
    "FROM pg_settings WHERE name='rds.extensions'";

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.AURORA_PG];
  }

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    if (!(await super.isDialect(targetClient))) {
      return false;
    }

    return await targetClient.client
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
}
