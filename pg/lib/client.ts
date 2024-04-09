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

import { Client, QueryResult } from "pg";
import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";
import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";
import { PgErrorHandler } from "./pg_error_handler";
import { PgConnectionUrlParser } from "./pg_connection_url_parser";
import { AuroraPgDatabaseDialect } from "./dialect/aurora_pg_database_dialect";

export class AwsPGClient extends AwsClient {
  constructor(config: any) {
    super(config, new PgErrorHandler(), new AuroraPgDatabaseDialect(), new PgConnectionUrlParser());
    this.config = config;
    this.isConnected = false;
    this._createClientFunc = (config: any) => {
      return new Client(WrapperProperties.removeWrapperProperties(config));
    };
    this._connectFunc = () => {
      return this.targetClient.connect();
    };
  }

  async connect(): Promise<void> {
    await this.internalConnect();
    const res: Promise<void> = this.pluginManager.connect(this.pluginService.getCurrentHostInfo(), this.properties, true, () => {
      this.targetClient = new Client(WrapperProperties.removeWrapperProperties(this.config));
      return this.targetClient.connect();
    });
    this.isConnected = true;
    return res;
  }

  executeQuery(props: Map<string, any>, sql: string): Promise<QueryResult> {
    return this.targetClient.query(sql);
  }

  query(text: string): Promise<QueryResult> {
    return this.pluginManager.execute(
      this.pluginService.getCurrentHostInfo(),
      this.properties,
      "query",
      async () => {
        return this.targetClient.query(text);
      },
      text
    );
  }

  end(): Promise<void> {
    return this.pluginManager.execute(this.pluginService.getCurrentHostInfo(), this.properties, "end", () => this.targetClient.end(), null);
  }

  isValid(): boolean {
    return this.isConnected && this.targetClient.connection._connecting;
  }
}
