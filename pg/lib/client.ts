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

import { ClientConfig, QueryArrayConfig, QueryArrayResult, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow, Submittable } from "pg";
import { AwsClient } from "../../common/lib/aws_client";
import { PgConnectionUrlParser } from "./pg_connection_url_parser";
import { DatabaseDialect, DatabaseType } from "../../common/lib/database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../../common/lib/database_dialect/database_dialect_codes";
import { RdsPgDatabaseDialect } from "./dialect/rds_pg_database_dialect";
import { PgDatabaseDialect } from "./dialect/pg_database_dialect";
import { AuroraPgDatabaseDialect } from "./dialect/aurora_pg_database_dialect";
import {
  AwsPoolConfig,
  AwsWrapperError,
  ConnectionProvider,
  FailoverSuccessError,
  HostInfo,
  InternalPooledConnectionProvider,
  TransactionIsolationLevel,
  UndefinedClientError,
  UnsupportedMethodError
} from "../../common/lib";
import { Messages } from "../../common/lib/utils/messages";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { RdsMultiAZClusterPgDatabaseDialect } from "./dialect/rds_multi_az_pg_database_dialect";
import { TelemetryTraceLevel } from "../../common/lib/utils/telemetry/telemetry_trace_level";
import { NodePostgresDriverDialect } from "./dialect/node_postgres_driver_dialect";
import { isDialectTopologyAware } from "../../common/lib/utils/utils";
import { PGClient, PGPoolClient } from "./pg_client";
import { DriverConnectionProvider } from "../../common/lib/driver_connection_provider";
import { AwsClientConfig } from "../../common/lib/wrapper_property";

export interface AwsPgClientConfig extends ClientConfig, AwsClientConfig {}

class BaseAwsPgClient extends AwsClient implements PGClient {
  private static readonly knownDialectsByCode: Map<string, DatabaseDialect> = new Map([
    [DatabaseDialectCodes.PG, new PgDatabaseDialect()],
    [DatabaseDialectCodes.RDS_PG, new RdsPgDatabaseDialect()],
    [DatabaseDialectCodes.AURORA_PG, new AuroraPgDatabaseDialect()],
    [DatabaseDialectCodes.RDS_MULTI_AZ_PG, new RdsMultiAZClusterPgDatabaseDialect()]
  ]);

  constructor(config: AwsPgClientConfig, connectionProvider?: ConnectionProvider) {
    super(
      config,
      DatabaseType.POSTGRES,
      BaseAwsPgClient.knownDialectsByCode,
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

  isReadOnly(): boolean | undefined {
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

  getTransactionIsolation(): TransactionIsolationLevel | undefined {
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

  getSchema(): string | undefined {
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
        this.targetClient = undefined;
        this.isConnected = false;
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
    const context = this.telemetryFactory.openTelemetryContext("awsClient.connect", TelemetryTraceLevel.TOP_LEVEL);
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
          if (role !== undefined && role !== result.hostInfo.role) {
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

  query(text: string): Promise<any>;

  query(text: string, values: any[]): Promise<any>;

  query<T extends Submittable>(queryStream: T): T;

  query<R extends any[] = any[], I = any[]>(queryConfig: QueryArrayConfig<I>, values?: QueryConfigValues<I>): Promise<QueryArrayResult<R>>;

  query<R extends QueryResultRow = any, I = any>(queryConfig: QueryConfig<I>): Promise<QueryResult<R>>;

  async query<R extends QueryResultRow = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>
  ): Promise<QueryResult<R>> {
    // config can be a string or a query config object
    const host = this.pluginService.getCurrentHostInfo();
    const context = this.telemetryFactory.openTelemetryContext("awsClient.query", TelemetryTraceLevel.TOP_LEVEL);
    return await context.start(async () => {
      return await this.pluginManager.execute(
        host,
        this.properties,
        "query",
        async () => {
          if (!this.targetClient) {
            throw new UndefinedClientError();
          }
          const sql = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
          await this.pluginService.updateState(sql);
          return values !== undefined ? this.targetClient.query(queryTextOrConfig, values) : this.targetClient.query(queryTextOrConfig);
        },
        [queryTextOrConfig, values]
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
          throw new UndefinedClientError();
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
          throw new UndefinedClientError();
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
          throw new UndefinedClientError();
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
          throw new UndefinedClientError();
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
          throw new UndefinedClientError();
        }
        return await this.targetClient.client.prepare(name, text, nParams);
      },
      [name, text, nParams]
    );
  }
}

export class AwsPGClient extends BaseAwsPgClient {
  constructor(config: any) {
    super(config, new DriverConnectionProvider());
  }
}

class AwsPGPooledConnection extends BaseAwsPgClient {
  constructor(config: any, provider: ConnectionProvider) {
    super(config, provider);
  }

  async release(): Promise<void> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "release",
      async () => {
        if (!this.targetClient) {
          throw new UndefinedClientError();
        }
        this.pluginService.removeErrorListener(this.targetClient);
        return await this.targetClient.client.release();
      },
      null
    );
  }
}

export type { AwsPGPooledConnection };

export class AwsPgPoolClient implements PGPoolClient {
  private readonly connectionProvider: InternalPooledConnectionProvider;
  private readonly config;
  private readonly poolConfig;

  constructor(config: any, poolConfig?: AwsPoolConfig) {
    this.connectionProvider = new InternalPooledConnectionProvider(poolConfig);
    this.config = config;
    this.poolConfig = poolConfig;
  }

  async connect(): Promise<AwsPGPooledConnection> {
    const awsPGPooledConnection: AwsPGPooledConnection = new AwsPGPooledConnection(this.config, this.connectionProvider);
    await awsPGPooledConnection.connect();
    return awsPGPooledConnection;
  }

  async end(): Promise<void> {
    await this.connectionProvider.releaseResources();
  }

  query(text: string): Promise<any>;

  query(text: string, values: any[]): Promise<any>;

  query<T extends Submittable>(queryStream: T): T;

  query<R extends any[] = any[], I = any[]>(queryConfig: QueryArrayConfig<I>, values?: QueryConfigValues<I>): Promise<QueryArrayResult<R>>;

  query<R extends QueryResultRow = any, I = any>(queryConfig: QueryConfig<I>): Promise<QueryResult<R>>;

  async query<R extends QueryResultRow = any, I = any[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>
  ): Promise<QueryResult<R>> {
    const awsPGPooledConnection: AwsPGPooledConnection = new AwsPGPooledConnection(this.config, this.connectionProvider);
    try {
      await awsPGPooledConnection.connect();
      const res = await awsPGPooledConnection.query(queryTextOrConfig as any, values);
      await awsPGPooledConnection.end();
      return res;
    } catch (error: any) {
      if (!(error instanceof FailoverSuccessError)) {
        // Release pooled connection.
        await awsPGPooledConnection.end();
      }
      throw error;
    }
  }
}
