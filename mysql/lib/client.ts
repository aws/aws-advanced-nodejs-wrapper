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

import { AwsClient } from "../../common/lib/aws_client";
import { ErrorPacketParams, OkPacketParams, Query, QueryOptions, QueryResult } from "mysql2";
import { ConnectionOptions, Prepare, PrepareStatementInfo } from "mysql2/promise";
import { MySQLConnectionUrlParser } from "./mysql_connection_url_parser";
import { DatabaseDialect, DatabaseType } from "../../common/lib/database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../../common/lib/database_dialect/database_dialect_codes";
import { MySQLDatabaseDialect } from "./dialect/mysql_database_dialect";
import { AuroraMySQLDatabaseDialect } from "./dialect/aurora_mysql_database_dialect";
import { RdsMySQLDatabaseDialect } from "./dialect/rds_mysql_database_dialect";
import {
  AwsPoolConfig,
  AwsWrapperError,
  ConnectionProvider,
  FailoverSuccessError,
  InternalPooledConnectionProvider,
  TransactionIsolationLevel,
  UndefinedClientError,
  UnsupportedMethodError
} from "../../common/lib";
import { Messages } from "../../common/lib/utils/messages";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { ClientUtils } from "../../common/lib/utils/client_utils";
import { RdsMultiAZClusterMySQLDatabaseDialect } from "./dialect/rds_multi_az_mysql_database_dialect";
import { TelemetryTraceLevel } from "../../common/lib/utils/telemetry/telemetry_trace_level";
import { MySQL2DriverDialect } from "./dialect/mysql2_driver_dialect";
import { isDialectTopologyAware } from "../../common/lib/utils/utils";
import { MySQLClient, MySQLPoolClient } from "./mysql_client";
import { DriverConnectionProvider } from "../../common/lib/driver_connection_provider";
import { AwsClientConfig } from "../../common/lib/wrapper_property";

export interface AwsMySQLClientConfig extends ConnectionOptions, AwsClientConfig {}

class BaseAwsMySQLClient extends AwsClient implements MySQLClient {
  private static readonly knownDialectsByCode: Map<string, DatabaseDialect> = new Map([
    [DatabaseDialectCodes.MYSQL, new MySQLDatabaseDialect()],
    [DatabaseDialectCodes.RDS_MYSQL, new RdsMySQLDatabaseDialect()],
    [DatabaseDialectCodes.AURORA_MYSQL, new AuroraMySQLDatabaseDialect()],
    [DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL, new RdsMultiAZClusterMySQLDatabaseDialect()]
  ]);

  constructor(config: AwsMySQLClientConfig, connectionProvider?: ConnectionProvider) {
    super(
      config,
      DatabaseType.MYSQL,
      BaseAwsMySQLClient.knownDialectsByCode,
      new MySQLConnectionUrlParser(),
      new MySQL2DriverDialect(),
      connectionProvider ?? new DriverConnectionProvider()
    );
  }

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

  private async queryWithoutUpdate(options: QueryOptions): Promise<Query> {
    const host = this.pluginService.getCurrentHostInfo();

    return this.pluginManager.execute(
      host,
      this.properties,
      "query",
      async () => {
        if (!this.targetClient) {
          throw new UndefinedClientError();
        }
        return await ClientUtils.queryWithTimeout(this.targetClient.client?.query(options), this.properties);
      },
      options
    );
  }

  async setReadOnly(readOnly: boolean): Promise<Query | void> {
    this.pluginService.getSessionStateService().setupPristineReadOnly();
    const result = await this.queryWithoutUpdate({ sql: `SET SESSION TRANSACTION READ ${readOnly ? "ONLY" : "WRITE"}` });
    this.pluginService.getSessionStateService().updateReadOnly(readOnly);
    return result;
  }

  isReadOnly(): boolean | undefined {
    return this.pluginService.getSessionStateService().getReadOnly();
  }

  async setAutoCommit(autoCommit: boolean): Promise<Query | void> {
    this.pluginService.getSessionStateService().setupPristineAutoCommit();

    let setting = "1";
    if (!autoCommit) {
      setting = "0";
    }
    const result = await this.queryWithoutUpdate({ sql: `SET AUTOCOMMIT=${setting}` });
    this.pluginService.getSessionStateService().setAutoCommit(autoCommit);
    return result;
  }

  getAutoCommit(): boolean | undefined {
    return this.pluginService.getSessionStateService().getAutoCommit();
  }

  async setCatalog(catalog: string): Promise<Query | void> {
    if (!catalog) {
      return;
    }
    this.pluginService.getSessionStateService().setupPristineCatalog();
    await this.queryWithoutUpdate({ sql: `USE ${catalog}` });
    this.pluginService.getSessionStateService().setCatalog(catalog);
  }

  getCatalog(): string | undefined {
    return this.pluginService.getSessionStateService().getCatalog();
  }

  async setSchema(schema: string): Promise<Query | void> {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "setSchema"));
  }

  getSchema(): string | undefined {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "getSchema"));
  }

  async setTransactionIsolation(level: TransactionIsolationLevel): Promise<Query | void> {
    if (level == this.getTransactionIsolation()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineTransactionIsolation();

    switch (level) {
      case TransactionIsolationLevel.TRANSACTION_READ_UNCOMMITTED:
        await this.queryWithoutUpdate({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED" });
        break;
      case TransactionIsolationLevel.TRANSACTION_READ_COMMITTED:
        await this.queryWithoutUpdate({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED" });
        break;
      case TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ:
        await this.queryWithoutUpdate({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ" });
        break;
      case TransactionIsolationLevel.TRANSACTION_SERIALIZABLE:
        await this.queryWithoutUpdate({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE" });
        break;
      default:
        throw new AwsWrapperError(Messages.get("Client.invalidTransactionIsolationLevel", String(level)));
    }

    this.pluginService.getSessionStateService().setTransactionIsolation(level);
  }

  getTransactionIsolation(): TransactionIsolationLevel | undefined {
    return this.pluginService.getSessionStateService().getTransactionIsolation();
  }

  async end() {
    if (!this.isConnected || !this.targetClient) {
      // No connections have been initialized.
      // This might happen if end is called in a finally block when an error occurred while initializing the first connection.
      return;
    }

    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "end",
      () => {
        this.pluginService.removeErrorListener(this.targetClient);
        if (!this.targetClient) {
          this.isConnected = false;
          return Promise.resolve();
        }
        const res = ClientUtils.queryWithTimeout(this.targetClient.end(), this.properties);
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

  async beginTransaction(): Promise<void> {
    await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "beginTransaction",
      async () => {
        if (this.targetClient) {
          this.pluginService.updateInTransaction("START TRANSACTION");
          return await this.targetClient.client.beginTransaction();
        }
        return null;
      },
      null
    );
  }

  async commit(): Promise<void> {
    await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "commit",
      async () => {
        if (this.targetClient) {
          this.pluginService.updateInTransaction("COMMIT");
          return await this.targetClient.client.commit();
        }
        return null;
      },
      null
    );
  }

  async changeUser(options: ConnectionOptions): Promise<void> {
    await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "changeUser",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.changeUser(options);
        }
        return null;
      },
      options
    );
  }

  async destroy(): Promise<void> {
    await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "destroy",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.destroy();
        }
        return null;
      },
      null
    );
  }

  async pause(): Promise<void> {
    await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "pause",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.pause();
        }
        return null;
      },
      null
    );
  }

  async resume(): Promise<void> {
    await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "resume",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.resume();
        }
        return null;
      },
      null
    );
  }

  async escape(value: any): Promise<string> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "escape",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.escape(value);
        }
        return null;
      },
      value
    );
  }

  escapeId(value: string): Promise<string>;
  escapeId(values: string[]): Promise<string>;
  async escapeId(values: unknown): Promise<string> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "escapeId",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.escapeId(values);
        }
        return null;
      },
      values
    );
  }

  async format(sql: string, values?: any | any[] | { [param: string]: any }): Promise<string> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "format",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.format(sql, values);
        }
        return null;
      },
      [sql, values]
    );
  }

  async prepare(sql: string): Promise<Prepare> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "prepare",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.prepare(sql);
        }
        return null;
      },
      sql
    );
  }

  async unprepare(sql: string): Promise<PrepareStatementInfo> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "unprepare",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.unprepare(sql);
        }
        return null;
      },
      sql
    );
  }

  async serverHandshake(args: any): Promise<any> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "serverHandshake",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.serverHandshake(args);
        }
        return null;
      },
      args
    );
  }

  async ping(): Promise<void> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "ping",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.ping();
        }
        return null;
      },
      null
    );
  }

  async writeOk(args?: OkPacketParams): Promise<void> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "writeOk",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.writeOk(args);
        }
        return null;
      },
      args
    );
  }

  async writeError(args?: ErrorPacketParams): Promise<void> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "writeError",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.writeError(args);
        }
        return null;
      },
      args
    );
  }

  async writeEof(warnings?: number, statusFlags?: number): Promise<void> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "writeEof",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.writeEof(warnings, statusFlags);
        }
        return null;
      },
      [warnings, statusFlags]
    );
  }

  async writeTextResult(rows?: Array<any>, columns?: Array<any>): Promise<void> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "writeTextResult",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.writeTextResult(rows, columns);
        }
        return null;
      },
      [rows, columns]
    );
  }

  async writePacket(packet: any): Promise<void> {
    return await this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "writePacket",
      async () => {
        if (this.targetClient) {
          return await this.targetClient.client.writePacket(packet);
        }
        return null;
      },
      packet
    );
  }

  query<T extends QueryResult>(sql: string): Promise<[T, any]>;
  query<T extends QueryResult>(sql: string, values: any): Promise<[T, any]>;
  query<T extends QueryResult>(options: QueryOptions): Promise<[T, any]>;
  query<T extends QueryResult>(options: QueryOptions, values: any): Promise<[T, any]>;
  async query(options: string | QueryOptions, values?: any): Promise<[any, any]> {
    if (!this.isConnected) {
      await this.connect(); // client.connect is not required for MySQL clients
      this.isConnected = true;
    }
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

          // Handle parameterized queries
          await this.updateState(this.targetClient.client, options, values);
          return await ClientUtils.queryWithTimeout(this.targetClient.client?.query(options, values), this.properties);
        },
        [options, values]
      );
    });
  }

  execute<T extends QueryResult>(sql: string): Promise<[T, any]>;
  execute<T extends QueryResult>(sql: string, values: any): Promise<[T, any]>;
  execute<T extends QueryResult>(options: QueryOptions): Promise<[T, any]>;
  async execute(options: string | QueryOptions, values?: any): Promise<[any, any]> {
    if (!this.isConnected) {
      await this.connect(); // client.connect is not required for MySQL clients
      this.isConnected = true;
    }
    const host = this.pluginService.getCurrentHostInfo();
    const context = this.telemetryFactory.openTelemetryContext("awsClient.execute", TelemetryTraceLevel.TOP_LEVEL);
    return await context.start(async () => {
      return await this.pluginManager.execute(
        host,
        this.properties,
        "execute",
        async () => {
          if (!this.targetClient) {
            throw new UndefinedClientError();
          }

          // Handle parameterized queries
          await this.updateState(this.targetClient.client, options, values);
          return await ClientUtils.queryWithTimeout(this.targetClient.client.execute(options, values), this.properties);
        },
        [options, values]
      );
    });
  }

  private async updateState(client: any, options: string | QueryOptions, values?: any): Promise<any> {
    let sql: string;
    if (typeof options === "string") {
      sql = client.format(options, values);
    } else {
      sql = client.format(options.sql, options.values);
    }
    await this.pluginService.updateState(sql);
  }
}

export class AwsMySQLClient extends BaseAwsMySQLClient {
  constructor(config: any) {
    super(config, new DriverConnectionProvider());
  }
}

class AwsMySQLPooledConnection extends BaseAwsMySQLClient {
  constructor(config: any, provider: ConnectionProvider) {
    super(config, provider);
  }
}

export type { AwsMySQLPooledConnection };

export class AwsMySQLPoolClient implements MySQLPoolClient {
  private readonly connectionProvider: InternalPooledConnectionProvider;
  private readonly config;
  private readonly poolConfig;

  constructor(config: any, poolConfig?: AwsPoolConfig) {
    this.connectionProvider = new InternalPooledConnectionProvider(poolConfig);
    this.config = config;
    this.poolConfig = poolConfig;
  }

  async end(): Promise<void> {
    await this.connectionProvider.releaseResources();
  }

  async getConnection(): Promise<AwsMySQLPooledConnection> {
    const client = new AwsMySQLPooledConnection(this.config, this.connectionProvider);
    await client.connect();
    return client;
  }

  releaseConnection(connection: AwsMySQLPooledConnection): Promise<void> {
    return connection.end();
  }

  query<T extends QueryResult>(sql: string): Promise<[T, any]>;
  query<T extends QueryResult>(sql: string, values: any): Promise<[T, any]>;
  query<T extends QueryResult>(options: QueryOptions): Promise<[T, any]>;
  query<T extends QueryResult>(options: QueryOptions, values: any): Promise<[T, any]>;
  async query(options: string | QueryOptions, values?: any): Promise<[any, any]> {
    const awsMySQLPooledConnection: AwsMySQLPooledConnection = new AwsMySQLPooledConnection(this.config, this.connectionProvider);
    try {
      await awsMySQLPooledConnection.connect();
      const res = await awsMySQLPooledConnection.query(options as any, values);
      await awsMySQLPooledConnection.end();
      return res;
    } catch (error: any) {
      if (!(error instanceof FailoverSuccessError)) {
        // Release pooled connection.
        await awsMySQLPooledConnection.end();
      }
      throw error;
    }
  }
}
