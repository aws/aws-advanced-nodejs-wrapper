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

import { QueryOptions } from "mysql2/typings/mysql/lib/protocol/sequences/Query";
import { AwsClient } from "../../common/lib/aws_client";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { createConnection, Query } from "mysql2";
import { MySQLErrorHandler } from "./mysql_error_handler";
import { MySQLConnectionUrlParser } from "./mysql_connection_url_parser";
import { DatabaseDialect, DatabaseType } from "../../common/lib/database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../../common/lib/database_dialect/database_dialect_codes";
import { MySQLDatabaseDialect } from "./dialect/mysql_database_dialect";
import { AuroraMySQLDatabaseDialect } from "./dialect/aurora_mysql_database_dialect";
import { RdsMySQLDatabaseDialect } from "./dialect/rds_mysql_database_dialect";
import { TransactionIsolationLevel } from "../../common/lib/utils/transaction_isolation_level";
import { AwsWrapperError, UnsupportedMethodError } from "../../common/lib/utils/errors";
import { Messages } from "../../common/lib/utils/messages";
import { logger } from "../../common/logutils";

export class AwsMySQLClient extends AwsClient {
  private static readonly knownDialectsByCode: Map<string, DatabaseDialect> = new Map([
    [DatabaseDialectCodes.MYSQL, new MySQLDatabaseDialect()],
    [DatabaseDialectCodes.RDS_MYSQL, new RdsMySQLDatabaseDialect()],
    [DatabaseDialectCodes.AURORA_MYSQL, new AuroraMySQLDatabaseDialect()]
  ]);

  constructor(config: any) {
    super(config, new MySQLErrorHandler(), DatabaseType.MYSQL, AwsMySQLClient.knownDialectsByCode, new MySQLConnectionUrlParser());
    this.config = config;
    this._createClientFunc = (config: any) => {
      return createConnection(WrapperProperties.removeWrapperProperties(config));
    };
    this.resetState();
  }

  async connect(): Promise<void> {
    await this.internalConnect();
    const hostInfo = this.pluginService.getCurrentHostInfo();
    if (hostInfo == null) {
      throw new AwsWrapperError("HostInfo was not provided.");
    }
    const conn: any = await this.pluginManager.connect(hostInfo, this.properties, true);
    await this.pluginService.setCurrentClient(conn, hostInfo);
    // TODO review the this.isConnected  usage. Perhaps we don't need this variable at all.
    // This could be determined based on the state of _targetClient, e.g. is it set or not.
    this.isConnected = true;
    await this.internalPostConnect();
    return;
  }

  async executeQuery(props: Map<string, any>, sql: string): Promise<Query> {
    if (!this.isConnected) {
      await this.connect(); // client.connect is not required for MySQL clients
      this.isConnected = true;
    }
    return this.targetClient.promise().query({ sql: sql });
  }

  async query(options: QueryOptions, callback?: any): Promise<Query> {
    if (!this.isConnected) {
      await this.connect(); // client.connect is not required for MySQL clients
      this.isConnected = true;
    }
    const host = this.pluginService.getCurrentHostInfo();
    return this.pluginManager.execute(
      host,
      this.properties,
      "query",
      async () => {
        await this.pluginService.updateState(options.sql);
        return await this.targetClient.promise().query(options, callback);
      },
      options
    );
  }

  async setReadOnly(readOnly: boolean): Promise<Query | void>;
  async setReadOnly(readOnly: boolean, timeout: number): Promise<Query | void>;
  async setReadOnly(readOnly: boolean, timeout?: number): Promise<Query | void> {
    if (readOnly === this.isReadOnly()) {
      return Promise.resolve();
    }
    const previousReadOnly: boolean = this.isReadOnly();
    let result;
    try {
      this._isReadOnly = readOnly;
      logger.debug(`Attempting to set readOnly ${readOnly}`);

      if (this.isReadOnly()) {
        result = await this.query({ sql: "SET SESSION TRANSACTION READ ONLY;", timeout: timeout });
      } else {
        result = await this.query({ sql: "SET SESSION TRANSACTION READ WRITE;", timeout: timeout });
      }
    } catch (error) {
      // revert
      logger.debug(`Unable to set readOnly ${readOnly}`);
      this._isReadOnly = previousReadOnly;
      throw error;
    }
    this.pluginService.getSessionStateService().setupPristineReadOnly();
    this.pluginService.getSessionStateService().setReadOnly(readOnly);
    return result;
  }

  isReadOnly(): boolean {
    return this._isReadOnly;
  }

  async setAutoCommit(autoCommit: boolean): Promise<Query | void> {
    if (autoCommit === this.getAutoCommit()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineAutoCommit();
    this.pluginService.getSessionStateService().setAutoCommit(autoCommit);

    this._isAutoCommit = autoCommit;
    let setting = "1";
    if (!autoCommit) {
      setting = "0";
    }
    return await this.query({ sql: `SET AUTOCOMMIT=${setting}` });
  }

  getAutoCommit(): boolean {
    return this._isAutoCommit;
  }

  async setCatalog(catalog: string): Promise<Query | void> {
    if (catalog === this.getCatalog()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineCatalog();
    this.pluginService.getSessionStateService().setCatalog(catalog);

    this._catalog = catalog;
    await this.query({ sql: `USE ${catalog}` });
  }

  getCatalog(): string {
    return this._catalog;
  }

  async setSchema(schema: string): Promise<Query | void> {
    throw new UnsupportedMethodError(Messages.get("Client.methodNotSupported"));
  }

  getSchema(): string {
    return this._schema;
  }

  async setTransactionIsolation(level: TransactionIsolationLevel): Promise<Query | void> {
    if (level === this.getTransactionIsolation()) {
      return;
    }

    this.pluginService.getSessionStateService().setupPristineTransactionIsolation();
    this.pluginService.getSessionStateService().setTransactionIsolation(level);

    this._isolationLevel = level;
    switch (level) {
      case 0:
        await this.query({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED" });
        break;
      case 1:
        await this.query({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED" });
        break;
      case 2:
        await this.query({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ" });
        break;
      case 3:
        await this.query({ sql: "SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE" });
        break;
      default:
        throw new AwsWrapperError(Messages.get("Client.invalidTransactionIsolationLevel", String(level)));
    }

    this._isolationLevel = level;
  }

  getTransactionIsolation(): number {
    return this._isolationLevel;
  }

  end() {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "end",
      () => {
        return this.targetClient.promise().end();
      },
      null
    );
  }

  async rollback(): Promise<Query> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "rollback",
      () => {
        this.pluginService.updateInTransaction("rollback");
        return this.targetClient.promise().rollback();
      },
      null
    );
  }

  resetState() {
    this._isReadOnly = false;
    this._isAutoCommit = true;
    this._catalog = "";
    this._schema = "";
    this._isolationLevel = TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ;
  }
}
