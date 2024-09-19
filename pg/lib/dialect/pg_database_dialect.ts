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

import { DatabaseDialect, DatabaseType } from "../../../common/lib/database_dialect/database_dialect";
import { HostListProviderService } from "../../../common/lib/host_list_provider_service";
import { HostListProvider } from "../../../common/lib/host_list_provider/host_list_provider";
import {
  ConnectionStringHostListProvider
} from "../../../common/lib/host_list_provider/connection_string_host_list_provider";
import { AwsWrapperError } from "../../../common/lib/utils/errors";
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { TransactionIsolationLevel } from "../../../common/lib/utils/transaction_isolation_level";
import { ClientWrapper } from "../../../common/lib/client_wrapper";

export class PgDatabaseDialect implements DatabaseDialect {
  protected dialectName: string = this.constructor.name;
  protected defaultPort: number = 5432;

  getDefaultPort(): number {
    return this.defaultPort;
  }

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.AURORA_PG, DatabaseDialectCodes.RDS_PG];
  }

  getHostAliasQuery(): string {
    return "SELECT CONCAT(inet_server_addr(), ':', inet_server_port())";
  }

  async getHostAliasAndParseResults(targetClient: ClientWrapper): Promise<string> {
    return targetClient.client
      .query(this.getHostAliasQuery())
      .then((rows: any) => {
        return rows.rows[0]["concat"];
      })
      .catch((error: any) => {
        throw new AwsWrapperError("Unable to fetch host alias or could not parse results: ", error.message);
      });
  }

  getServerVersionQuery(): string {
    return "SELECT 'version', VERSION()";
  }

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    return await targetClient.client
      .query("SELECT 1 FROM pg_proc LIMIT 1")
      .then((result: { rows: any }) => {
        return !!result.rows[0];
      })
      .catch(() => {
        return false;
      });
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    return new ConnectionStringHostListProvider(props, originalUrl, this.getDefaultPort(), hostListProviderService);
  }

  async tryClosingTargetClient(targetClient: ClientWrapper) {
    await targetClient.client.end().catch((error: any) => {
      // ignore
    });
  }

  async isClientValid(targetClient: ClientWrapper): Promise<boolean> {
    try {
      return await targetClient.client
        .query("SELECT 1")
        .then(() => {
          return true;
        })
        .catch((error: any) => {
          return false;
        });
    } catch (error: any) {
      return false;
    }
  }

  getConnectFunc(targetClient: any): () => Promise<any> {
    return async () => {
      return await targetClient.connect();
    };
  }

  getDatabaseType(): DatabaseType {
    return DatabaseType.POSTGRES;
  }

  getDialectName(): string {
    return this.dialectName;
  }

  doesStatementSetAutoCommit(statement: string): boolean | undefined {
    return undefined;
  }

  doesStatementSetCatalog(statement: string): string | undefined {
    return undefined;
  }

  doesStatementSetReadOnly(statement: string): boolean | undefined {
    if (statement.toLowerCase().includes("set session characteristics as transaction read only")) {
      return true;
    }

    if (statement.toLowerCase().includes("set session characteristics as transaction read write")) {
      return false;
    }

    return undefined;
  }

  doesStatementSetSchema(statement: string): string | undefined {
    if (statement.toLowerCase().includes("set search_path to ")) {
      return statement.split(" ")[3];
    }

    return undefined;
  }

  doesStatementSetTransactionIsolation(statement: string): number | undefined {
    if (statement.toLowerCase().includes("set session characteristics as transaction isolation level read uncommitted")) {
      return TransactionIsolationLevel.TRANSACTION_READ_COMMITTED;
    }

    if (statement.toLowerCase().includes("set session characteristics as transaction isolation level read committed")) {
      return TransactionIsolationLevel.TRANSACTION_READ_COMMITTED;
    }

    if (statement.toLowerCase().includes("set session characteristics as transaction isolation level repeatable read")) {
      return TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ;
    }

    if (statement.toLowerCase().includes("set session characteristics as transaction isolation level serializable")) {
      return TransactionIsolationLevel.TRANSACTION_SERIALIZABLE;
    }

    return undefined;
  }

  async rollback(targetClient: ClientWrapper): Promise<any> {
    return await targetClient.client.rollback();
  }
}
