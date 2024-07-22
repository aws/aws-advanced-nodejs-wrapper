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
import { AwsClient } from "../../../common/lib/aws_client";
import { AwsWrapperError } from "../../../common/lib/utils/errors";
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { TransactionIsolationLevel } from "../../../common/lib/utils/transaction_isolation_level";
import { logger } from "../../../common/logutils";
import { AwsMySQLClient } from "../client";
import { WrapperProperties } from "../../../common/lib/wrapper_property";

export class MySQLDatabaseDialect implements DatabaseDialect {
  protected dialectName: string = "MySQLDatabaseDialect";
  protected defaultPort: number = 3306;
  private static readonly QUERY_TIMEOUT = WrapperProperties.QUERY_TIMEOUT_MS.defaultValue;


  getDefaultPort(): number {
    return this.defaultPort;
  }

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.AURORA_MYSQL, DatabaseDialectCodes.RDS_MYSQL];
  }

  getHostAliasQuery(): string {
    return "SELECT CONCAT(@@hostname, ':', @@port)";
  }

  async getHostAliasAndParseResults(client: AwsClient): Promise<string> {
    logger.debug("get alias parse");

    return client.targetClient
      .promise()
      .query({ sql: this.getHostAliasQuery(), timeout: WrapperProperties.QUERY_TIMEOUT_MS.defaultValue })
      .then(([rows]: any) => {
        return rows[0]["CONCAT(@@hostname, ':', @@port)"];
      })
      .catch((error: any) => {
        throw new AwsWrapperError("Unable to fetch host alias or could not parse results: ", error.message);
      });
  }

  getServerVersionQuery(): string {
    return "SHOW VARIABLES LIKE 'version_comment'";
  }

  async isDialect(targetClient: any): Promise<boolean> {
    logger.debug("query  is dialect");

    return await targetClient
      .promise()
      .query({ sql: this.getServerVersionQuery(), timeout: MySQLDatabaseDialect.QUERY_TIMEOUT })
      .then(([rows]: any) => {
        return rows[0]["Value"].toLowerCase().includes("mysql");
      })
      .catch((error: any) => {
        return false;
      });
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    return new ConnectionStringHostListProvider(props, originalUrl, this.getDefaultPort(), hostListProviderService);
  }

  async tryClosingTargetClient(targetClient: any) {
    try {
      await targetClient.promise().end();
    } catch (error) {
      // ignore
    }
  }

  async isClientValid(targetClient: any): Promise<boolean> {
    logger.debug("checking client valid");
    return await targetClient
      .promise()
      .query({ sql: "SELECT 1", timeout: WrapperProperties.QUERY_TIMEOUT_MS.defaultValue })
      .then(() => {
        logger.debug("client valid true");

        return true;
      })
      .catch(() => {
        logger.debug("client valid false");

        return false;
      });
  }

  getConnectFunc(targetClient: any): () => Promise<any> {
    return async () => {
      return await targetClient
        .promise()
        .connect()
        .catch((error: any) => {
          throw error;
        });
    };
  }

  getDatabaseType(): DatabaseType {
    return DatabaseType.MYSQL;
  }

  getDialectName(): string {
    return this.dialectName;
  }

  doesStatementSetReadOnly(statement: string): boolean | undefined {
    if (statement.includes("set session transaction read only")) {
      return true;
    }

    if (statement.includes("set session transaction read write")) {
      return false;
    }

    return undefined;
  }

  doesStatementSetAutoCommit(statement: string): boolean | undefined {
    if (statement.includes("set autocommit")) {
      const statementSections = statement.split("=");
      const value = statementSections[1].trim();
      if (value === "0") {
        return false;
      }

      if (value === "1") {
        return true;
      }
    }

    return undefined;
  }

  doesStatementSetTransactionIsolation(statement: string): TransactionIsolationLevel | undefined {
    if (statement.includes("set session transaction isolation level read uncommitted")) {
      return TransactionIsolationLevel.TRANSACTION_READ_UNCOMMITTED;
    }

    if (statement.includes("set session transaction isolation level read committed")) {
      return TransactionIsolationLevel.TRANSACTION_READ_COMMITTED;
    }

    if (statement.includes("set session transaction isolation level repeatable read")) {
      return TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ;
    }

    if (statement.includes("set session transaction isolation level serializable")) {
      return TransactionIsolationLevel.TRANSACTION_SERIALIZABLE;
    }

    return undefined;
  }

  doesStatementSetCatalog(statement: string): string | undefined {
    if (statement.includes("use")) {
      return statement.split(" ")[1];
    }

    return undefined;
  }

  doesStatementSetSchema(statement: string): string | undefined {
    return undefined;
  }
}
