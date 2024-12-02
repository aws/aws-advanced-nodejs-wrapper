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

import { QueryResult } from "pg";
import { AwsClient } from "../../common/lib/aws_client";
import { PgConnectionUrlParser } from "./pg_connection_url_parser";
import { DatabaseDialect, DatabaseType } from "../../common/lib/database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../../common/lib/database_dialect/database_dialect_codes";
import { RdsPgDatabaseDialect } from "./dialect/rds_pg_database_dialect";
import { PgDatabaseDialect } from "./dialect/pg_database_dialect";
import { AuroraPgDatabaseDialect } from "./dialect/aurora_pg_database_dialect";
import { AwsWrapperError, UnsupportedMethodError } from "../../common/lib/utils/errors";
import { Messages } from "../../common/lib/utils/messages";
import { TransactionIsolationLevel } from "../../common/lib/utils/transaction_isolation_level";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { RdsMultiAZPgDatabaseDialect } from "./dialect/rds_multi_az_pg_database_dialect";
import { HostInfo } from "../../common/lib/host_info";
import { TelemetryTraceLevel } from "../../common/lib/utils/telemetry/telemetry_trace_level";
import { NodePostgresDriverDialect } from "./dialect/node_postgres_driver_dialect";

export class AwsPGClient extends AwsClient {
  private static readonly knownDialectsByCode: Map<string, DatabaseDialect> = new Map([
    [DatabaseDialectCodes.PG, new PgDatabaseDialect()],
    [DatabaseDialectCodes.RDS_PG, new RdsPgDatabaseDialect()],
    [DatabaseDialectCodes.AURORA_PG, new AuroraPgDatabaseDialect()],
    [DatabaseDialectCodes.RDS_MULTI_AZ_PG, new RdsMultiAZPgDatabaseDialect()]
  ]);
  private schema: string = "";

  constructor(config: any) {
    super(config, DatabaseType.POSTGRES, AwsPGClient.knownDialectsByCode, new PgConnectionUrlParser(), new NodePostgresDriverDialect());
    this.resetState();
  }

  async connect(): Promise<void> {
    await this.internalConnect();
    const context = this.telemetryFactory.openTelemetryContext("AwsClient.connect", TelemetryTraceLevel.TOP_LEVEL);
    return await context.start(async () => {
      const hostInfo = this.pluginService.getCurrentHostInfo();
      if (hostInfo == null) {
        throw new AwsWrapperError(Messages.get("HostInfo.noHostParameter"));
      }
      const result: ClientWrapper = await this.pluginManager.connect(hostInfo, this.properties, true);
      await this.pluginService.setCurrentClient(result, result.hostInfo);
      await this.internalPostConnect();
    });
  }

  async query(text: string): Promise<QueryResult> {
    const context = this.telemetryFactory.openTelemetryContext("awsClient.query", TelemetryTraceLevel.TOP_LEVEL);
    return await context.start(async () => {
      return await this.pluginManager.execute(
        this.pluginService.getCurrentHostInfo(),
        this.properties,
        "query",
        async () => {
          await this.pluginService.updateState(text);
          return this.targetClient?.query(text);
        },
        text
      );
    });
  }

  async updateSessionStateReadOnly(readOnly: boolean): Promise<QueryResult | void> {
    return await this.targetClient.query(`SET SESSION CHARACTERISTICS AS TRANSACTION READ ${readOnly ? "ONLY" : "WRITE"}`);
  }

  private async readOnlyQuery(text: string): Promise<QueryResult> {
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
    let result;
    if (readOnly) {
      result = await this.readOnlyQuery("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    } else {
      result = await this.readOnlyQuery("SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE");
    }
    this._isReadOnly = readOnly;
    this.pluginService.getSessionStateService().setupPristineReadOnly();
    this.pluginService.getSessionStateService().setReadOnly(readOnly);
    return result;
  }

  isReadOnly(): boolean {
    return this._isReadOnly;
  }

  async setAutoCommit(autoCommit: boolean): Promise<QueryResult | void> {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "setAutoCommit"));
  }

  getAutoCommit(): boolean {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "getAutoCommit"));
  }

  async setTransactionIsolation(level: number): Promise<QueryResult | void> {
    if (level === this.getTransactionIsolation()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineTransactionIsolation();
    this.pluginService.getSessionStateService().setTransactionIsolation(level);

    this._isolationLevel = level;
    switch (level) {
      case 0:
        await this.query("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED");
        break;
      case 1:
        await this.query("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED");
        break;
      case 2:
        await this.query("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        break;
      case 3:
        await this.query("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        break;
      default:
        throw new AwsWrapperError(Messages.get("Client.invalidTransactionIsolationLevel", String(level)));
    }
  }

  getTransactionIsolation(): number {
    return this._isolationLevel;
  }

  async setCatalog(catalog: string): Promise<void> {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "setCatalog"));
  }

  getCatalog(): string {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported", "getCatalog"));
  }

  async setSchema(schema: string): Promise<QueryResult | void> {
    if (schema === this.getSchema()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineSchema();
    this.pluginService.getSessionStateService().setSchema(schema);

    this.schema = schema;
    return await this.query(`SET search_path TO ${schema};`);
  }

  getSchema(): string {
    return this.schema;
  }

  async end() {
    if (!this.isConnected || !this.targetClient) {
      // No connections have been initialized.
      // This might happen if end is called in a finally block when an error occurred while initializing the first connection.
      return;
    }
    const hostInfo: HostInfo | null = this.pluginService.getCurrentHostInfo();
    const result = await this.pluginManager.execute(
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
    return result;
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

  resetState() {
    this._isReadOnly = false;
    this.schema = "";
    this._isolationLevel = TransactionIsolationLevel.TRANSACTION_READ_COMMITTED;
  }
}
