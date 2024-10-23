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
import { AwsWrapperError } from "../../../common/lib/utils/errors";
import { DatabaseDialectCodes } from "../../../common/lib/database_dialect/database_dialect_codes";
import { TransactionIsolationLevel } from "../../../common/lib/utils/transaction_isolation_level";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { ClientUtils } from "../../../common/lib/utils/client_utils";
import { FailoverRestriction } from "../../../common/lib/plugins/failover/failover_restriction";
import { AwsPoolClient } from "../../../common/lib/aws_pool_client";
import { AwsMysqlPoolClient } from "../mysql_pool_client";
import { AwsPoolConfig } from "../../../common/lib/aws_pool_config";
import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { PoolOptions } from "mysql2/promise";

export class MySQLDatabaseDialect implements DatabaseDialect {
  protected dialectName: string = this.constructor.name;
  protected defaultPort: number = 3306;

  getDefaultPort(): number {
    return this.defaultPort;
  }

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL, DatabaseDialectCodes.AURORA_MYSQL, DatabaseDialectCodes.RDS_MYSQL];
  }

  getHostAliasQuery(): string {
    return "SELECT CONCAT(@@hostname, ':', @@port)";
  }

  async getHostAliasAndParseResults(targetClient: ClientWrapper): Promise<string> {
    return targetClient.client
      .query(this.getHostAliasQuery())
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

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    return await targetClient.client

      .query(this.getServerVersionQuery())
      .then(([rows]: any) => {
        return rows[0]["Value"].toLowerCase().includes("mysql");
      })
      .catch(() => {
        return false;
      });
  }

  getAwsPoolClient(props: PoolOptions): AwsPoolClient {
    return new AwsMysqlPoolClient(props);
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    return new ConnectionStringHostListProvider(props, originalUrl, this.getDefaultPort(), hostListProviderService);
  }

  async tryClosingTargetClient(targetClient: ClientWrapper) {
    try {
      await ClientUtils.queryWithTimeout(targetClient.client.destroy(), targetClient.properties);
    } catch (error: any) {
      // ignore
    }
  }

  async isClientValid(targetClient: ClientWrapper): Promise<boolean> {
    try {
      return await ClientUtils.queryWithTimeout(
        targetClient.client

          .query({ sql: "SELECT 1" })
          .then(() => {
            return true;
          })
          .catch(() => {
            return false;
          }),
        targetClient.properties
      );
    } catch (error) {
      return false;
    }
  }

  connect(targetClient: any): Promise<any> {
    return targetClient;
  }

  getDatabaseType(): DatabaseType {
    return DatabaseType.MYSQL;
  }

  getDialectName(): string {
    return this.dialectName;
  }

  getFailoverRestrictions(): FailoverRestriction[] {
    return [];
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

  async rollback(targetClient: ClientWrapper): Promise<any> {
    return await targetClient.client.rollback();
  }

  preparePoolClientProperties(props: Map<string, any>, poolConfig: AwsPoolConfig | undefined): any {
    const finalPoolConfig: PoolOptions = {};
    const finalClientProps = WrapperProperties.removeWrapperProperties(props);

    Object.assign(finalPoolConfig, finalClientProps);
    finalPoolConfig.connectionLimit = poolConfig?.maxConnections;
    finalPoolConfig.maxIdle = poolConfig?.maxIdleConnections;
    finalPoolConfig.idleTimeout = poolConfig?.idleTimeoutMillis;
    return finalPoolConfig;
  }

  async end(clientWrapper: ClientWrapper): Promise<void> {
    return await clientWrapper.client.end();
  }
}
