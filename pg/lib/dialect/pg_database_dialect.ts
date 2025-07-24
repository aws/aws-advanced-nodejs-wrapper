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
import { ConnectionStringHostListProvider } from "../../../common/lib/host_list_provider/connection_string_host_list_provider";
import { AwsWrapperError, UnsupportedMethodError } from "../../../common/lib/utils/errors";
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { TransactionIsolationLevel } from "../../../common/lib/utils/transaction_isolation_level";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { FailoverRestriction } from "../../../common/lib/plugins/failover/failover_restriction";
import { ErrorHandler } from "../../../common/lib/error_handler";
import { PgErrorHandler } from "../pg_error_handler";
import { Messages } from "../../../common/lib/utils/messages";
import { HostRole } from "../../../common/lib/host_role";

export class PgDatabaseDialect implements DatabaseDialect {
  protected dialectName: string = this.constructor.name;
  protected defaultPort: number = 5432;

  getDefaultPort(): number {
    return this.defaultPort;
  }

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.RDS_MULTI_AZ_PG, DatabaseDialectCodes.AURORA_PG, DatabaseDialectCodes.RDS_PG];
  }

  getHostAliasQuery(): string {
    return "SELECT CONCAT(inet_server_addr(), ':', inet_server_port())";
  }

  async getHostAliasAndParseResults(targetClient: ClientWrapper): Promise<string> {
    return targetClient
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

  getSetReadOnlyQuery(readOnly: boolean): string {
    return `SET SESSION CHARACTERISTICS AS TRANSACTION READ ${readOnly ? "ONLY" : "WRITE"}`;
  }

  getSetAutoCommitQuery(autoCommit: boolean): string {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "setAutoCommit"));
  }

  getSetTransactionIsolationQuery(level: TransactionIsolationLevel): string {
    let transactionIsolationLevel: string;
    switch (level) {
      case TransactionIsolationLevel.TRANSACTION_READ_UNCOMMITTED:
        transactionIsolationLevel = "READ UNCOMMITTED";
        break;
      case TransactionIsolationLevel.TRANSACTION_READ_COMMITTED:
        transactionIsolationLevel = "READ COMMITTED";
        break;
      case TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ:
        transactionIsolationLevel = "REPEATABLE READ";
        break;
      case TransactionIsolationLevel.TRANSACTION_SERIALIZABLE:
        transactionIsolationLevel = "SERIALIZABLE";
        break;
      default:
        throw new AwsWrapperError(Messages.get("Client.invalidTransactionIsolationLevel", String(level)));
    }
    return `SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL ${transactionIsolationLevel}`;
  }

  getSetCatalogQuery(catalog: string): string {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "setCatalog"));
  }

  getSetSchemaQuery(schema: string): string {
    return `SET search_path TO ${schema}`;
  }

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    return await targetClient
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

  getErrorHandler(): ErrorHandler {
    return new PgErrorHandler();
  }

  async isClientValid(targetClient: ClientWrapper): Promise<boolean> {
    try {
      return await targetClient
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

  getDatabaseType(): DatabaseType {
    return DatabaseType.POSTGRES;
  }

  getDialectName(): string {
    return this.dialectName;
  }

  getFailoverRestrictions(): FailoverRestriction[] {
    return [];
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

  doesStatementSetTransactionIsolation(statement: string): TransactionIsolationLevel | undefined {
    if (statement.toLowerCase().includes("set session characteristics as transaction isolation level read uncommitted")) {
      return TransactionIsolationLevel.TRANSACTION_READ_UNCOMMITTED;
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

  async getHostRole(targetClient: ClientWrapper): Promise<HostRole> {
    throw new UnsupportedMethodError(`Method getHostRole not supported for dialect: ${this.dialectName}`);
  }
}
