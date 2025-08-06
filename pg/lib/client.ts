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

import { QueryArrayConfig, QueryArrayResult, QueryConfig, QueryResult } from "pg";
import { AwsClient } from "../../common/lib/aws_client";
import { PgConnectionUrlParser } from "./pg_connection_url_parser";
import { DatabaseDialect, DatabaseType } from "../../common/lib/database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../../common/lib/database_dialect/database_dialect_codes";
import { RdsPgDatabaseDialect } from "./dialect/rds_pg_database_dialect";
import { PgDatabaseDialect } from "./dialect/pg_database_dialect";
import { AuroraPgDatabaseDialect } from "./dialect/aurora_pg_database_dialect";
import { AwsWrapperError, UnsupportedMethodError } from "../../common/lib/utils/errors";
import { Messages } from "../../common/lib/utils/messages";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { RdsMultiAZClusterPgDatabaseDialect } from "./dialect/rds_multi_az_pg_database_dialect";
import { HostInfo } from "../../common/lib/host_info";
import { TelemetryTraceLevel } from "../../common/lib/utils/telemetry/telemetry_trace_level";
import { NodePostgresDriverDialect } from "./dialect/node_postgres_driver_dialect";
import { TransactionIsolationLevel } from "../../common/lib/utils/transaction_isolation_level";
import { isDialectTopologyAware } from "../../common/lib/utils/utils";
import { PGClient } from "./pg_client";
import { ConnectionProvider } from "../../common/lib/connection_provider";
import { DriverConnectionProvider } from "../../common/lib/driver_connection_provider";

class BaseClient extends AwsClient implements PGClient {
  private static readonly knownDialectsByCode: Map<string, DatabaseDialect> = new Map([
    [DatabaseDialectCodes.PG, new PgDatabaseDialect()],
    [DatabaseDialectCodes.RDS_PG, new RdsPgDatabaseDialect()],
    [DatabaseDialectCodes.AURORA_PG, new AuroraPgDatabaseDialect()],
    [DatabaseDialectCodes.RDS_MULTI_AZ_PG, new RdsMultiAZClusterPgDatabaseDialect()]
  ]);

  constructor(config: any, connectionProvider?: ConnectionProvider) {
    super(
      config,
      DatabaseType.POSTGRES,
      BaseClient.knownDialectsByCode,
      new PgConnectionUrlParser(),
      new NodePostgresDriverDialect(),
      connectionProvider ?? new DriverConnectionProvider()
    );
  }

  // AWS Client Implementation

  private async queryWithoutUpdate(text: string): Promise<QueryResult> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "query",
      async () => {
        return this.targetClient?.client.query(text);
      },
      text
    );
  }

  async setReadOnly(readOnly: boolean): Promise<QueryResult | void> {
    this.pluginService.getSessionStateService().setupPristineReadOnly();
    const result = await this.queryWithoutUpdate(`SET SESSION CHARACTERISTICS AS TRANSACTION READ ${readOnly ? "ONLY" : "WRITE"}`);
    this.pluginService.getSessionStateService().updateReadOnly(readOnly);
    return result;
  }

  isReadOnly(): boolean {
    return this.pluginService.getSessionStateService().getReadOnly();
  }

  async setAutoCommit(autoCommit: boolean): Promise<QueryResult | void> {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "setAutoCommit"));
  }

  getAutoCommit(): boolean {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "getAutoCommit"));
  }

  async setTransactionIsolation(level: TransactionIsolationLevel): Promise<QueryResult | void> {
    if (level == this.getTransactionIsolation()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineTransactionIsolation();

    switch (level) {
      case TransactionIsolationLevel.TRANSACTION_READ_UNCOMMITTED:
        await this.queryWithoutUpdate("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ UNCOMMITTED");
        break;
      case TransactionIsolationLevel.TRANSACTION_READ_COMMITTED:
        await this.queryWithoutUpdate("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED");
        break;
      case TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ:
        await this.queryWithoutUpdate("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        break;
      case TransactionIsolationLevel.TRANSACTION_SERIALIZABLE:
        await this.queryWithoutUpdate("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        break;
      default:
        throw new AwsWrapperError(Messages.get("Client.invalidTransactionIsolationLevel", String(level)));
    }
    this.pluginService.getSessionStateService().setTransactionIsolation(level);
  }

  getTransactionIsolation(): TransactionIsolationLevel {
    return this.pluginService.getSessionStateService().getTransactionIsolation();
  }

  async setCatalog(catalog: string): Promise<void> {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "setCatalog"));
  }

  getCatalog(): string {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "getCatalog"));
  }

  async setSchema(schema: string): Promise<QueryResult | void> {
    if (!schema) {
      return;
    }

    if (schema === this.getSchema()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineSchema();
    const result = await this.queryWithoutUpdate(`SET search_path TO ${schema};`);
    this.pluginService.getSessionStateService().setSchema(schema);
    return result;
  }

  getSchema(): string {
    return this.pluginService.getSessionStateService().getSchema();
  }

  async end() {
    if (!this.isConnected || !this.targetClient) {
      // No connections have been initialized.
      // This might happen if end is called in a finally block when an error occurred while initializing the first connection.
      return;
    }
    const hostInfo: HostInfo | null = this.pluginService.getCurrentHostInfo();
    return await this.pluginManager.execute(
      hostInfo,
      this.properties,
      "end",
      () => {
        const res = this.targetClient!.end();
        this.targetClient = null;
        return res;
      },
      null
    );
  }

  async rollback(): Promise<any> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "rollback",
      async () => {
        if (this.targetClient) {
          this.pluginService.updateInTransaction("rollback");
          return await this.targetClient.rollback();
        }
        return null;
      },
      null
    );
  }

  // PG Client Implementation

  async connect(): Promise<void> {
    await this.internalConnect();
    const context = this.telemetryFactory.openTelemetryContext("AwsClient.connect", TelemetryTraceLevel.TOP_LEVEL);
    return await context.start(async () => {
      const hostInfo = this.pluginService.getCurrentHostInfo();
      if (hostInfo == null) {
        throw new AwsWrapperError(Messages.get("HostInfo.noHostParameter"));
      }
      const result: ClientWrapper = await this.pluginManager.connect(hostInfo, this.properties, true, null);
      if (isDialectTopologyAware(this.pluginService.getDialect())) {
        try {
          const role = await this.pluginService.getHostRole(result);
          // The current host role may be incorrect, use the created client to confirm the host role.
          if (role !== result.hostInfo.role) {
            result.hostInfo.role = role;
            this.pluginService.setCurrentHostInfo(result.hostInfo);
            this.pluginService.setInitialConnectionHostInfo(result.hostInfo);
          }
        } catch (error) {
          // Ignore
        }
      }
      await this.pluginService.setCurrentClient(result, result.hostInfo);
      await this.internalPostConnect();
    });
  }

  query(text: string): Promise<QueryResult>;
  query(text: string, values: any[]): Promise<QueryResult>;
  query(config: QueryConfig): Promise<QueryResult>;
  async query(config: string | QueryConfig | QueryArrayConfig, values?: any[]): Promise<QueryResult | QueryArrayResult> {
    // config can be a string or a query config object
    const context = this.telemetryFactory.openTelemetryContext("awsClient.query", TelemetryTraceLevel.TOP_LEVEL);
    return await context.start(async () => {
      return await this.pluginManager.execute(
        this.pluginService.getCurrentHostInfo(),
        this.properties,
        "query",
        async () => {
          const sql = typeof config === "string" ? config : config.text;
          await this.pluginService.updateState(sql);
          return this.targetClient?.query(config, values);
        },
        [config, values]
      );
    });
  }

  copyFrom(queryText: string): Promise<NodeJS.WritableStream> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "copyFrom",
      async () => {
        if (!this.targetClient) {
          throw new AwsWrapperError("targetClient is undefined, this code should not be reachable");
        }
        return await this.targetClient.client.copyFrom(queryText);
      },
      queryText
    );
  }

  copyTo(queryText: string): Promise<NodeJS.ReadableStream> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "copyTo",
      async () => {
        if (!this.targetClient) {
          throw new AwsWrapperError("targetClient is undefined, this code should not be reachable");
        }
        return await this.targetClient.client.copyTo(queryText);
      },
      queryText
    );
  }

  escapeIdentifier(str: string): Promise<string> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "escapeIdentifier",
      async () => {
        if (!this.targetClient) {
          throw new AwsWrapperError("targetClient is undefined, this code should not be reachable");
        }
        return await this.targetClient.client.escapeIdentifier(str);
      },
      str
    );
  }

  escapeLiteral(str: string): Promise<string> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "escapeLiteral",
      async () => {
        if (!this.targetClient) {
          throw new AwsWrapperError("targetClient is undefined, this code should not be reachable");
        }
        return await this.targetClient.client.escapeLiteral(str);
      },
      str
    );
  }

  prepare(name: string, text: string, nParams?: number): Promise<void> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "prepare",
      async () => {
        if (!this.targetClient) {
          throw new AwsWrapperError("targetClient is undefined, this code should not be reachable");
        }
        return await this.targetClient.client.prepare(name, text, nParams);
      },
      [name, text, nParams]
    );
  }
}

export class AwsPGClient extends BaseClient {
  constructor(config: any) {
    super(config, new DriverConnectionProvider());
  }
}
