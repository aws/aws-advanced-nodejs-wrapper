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
import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";
import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";
import { Connection, createConnection, Query } from "mysql2";
import { MySQLErrorHandler } from "./mysql_error_handler";
import { MySQLConnectionUrlParser } from "./mysql_connection_url_parser";
import { AuroraMySQLDatabaseDialect } from "./dialect/aurora_mysql_database_dialect";

export class AwsMySQLClient extends AwsClient {
  constructor(config: any) {
    super(config, new MySQLErrorHandler(), new AuroraMySQLDatabaseDialect(), new MySQLConnectionUrlParser());
    this.config = config;
    this._createClientFunc = (config: any) => {
      return createConnection(WrapperProperties.removeWrapperProperties(config));
    };
    this._isReadOnly = false;
    this._connectFunc = async () => {
      return await this.targetClient.promise().connect();
    };
  }

  async connect(): Promise<Connection> {
    await this.internalConnect();
    const conn: Promise<Connection> = this.pluginManager.connect(this.pluginService.getCurrentHostInfo(), this.properties, true, async () => {
      this.targetClient = this.pluginService.createTargetClient(this.properties);
      return this.targetClient.promise().connect();
    });
    await this.internalPostConnect();
    return conn;
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
        this.pluginService.updateInTransaction(options.sql);
        return await this.targetClient.promise().query(options, callback);
      },
      options
    );
  }

  async setReadOnly(readOnly: boolean): Promise<Query | void> {
    if (readOnly === this.isReadOnly()) {
      return Promise.resolve();
    }
    this._isReadOnly = readOnly;
    if (this.isReadOnly()) {
      return await this.query({ sql: "SET SESSION TRANSACTION READ ONLY;" });
    }

    return await this.query({ sql: "SET SESSION TRANSACTION READ WRITE;" });
  }

  isReadOnly(): boolean {
    return this._isReadOnly;
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

  rollback() {}
}
