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

import { ErrorPacketParams, OkPacketParams, Query, QueryOptions, QueryResult } from "mysql2";
import { ConnectionOptions, Prepare, PrepareStatementInfo } from "mysql2/promise";

export interface MySQLClient {
  // Methods supported by MySQL2's PromiseConnection
  // https://github.com/sidorares/node-mysql2/blob/master/lib/promise/connection.js

  beginTransaction(): Promise<void>;

  connect(): Promise<void>;

  commit(): Promise<void>;

  changeUser(options: ConnectionOptions): Promise<void>;

  end(): Promise<void>;

  end(options: any): Promise<void>;

  destroy(): Promise<void>;

  pause(): Promise<void>;

  resume(): Promise<void>;

  escape(value: any): Promise<string>;

  escapeId(value: string): Promise<string>;

  escapeId(values: string[]): Promise<string>;

  format(sql: string, values?: any | any[] | { [param: string]: any }): Promise<string>;

  rollback(): Promise<void>;

  prepare(sql: string): Promise<Prepare>;

  unprepare(sql: string): Promise<PrepareStatementInfo>;

  serverHandshake(args: any): Promise<any>;

  ping(): Promise<void>;

  writeOk(args?: OkPacketParams): Promise<void>;

  writeError(args?: ErrorPacketParams): Promise<void>;

  writeEof(warnings?: number, statusFlags?: number): Promise<void>;

  writeTextResult(rows?: Array<any>, columns?: Array<any>): Promise<void>;

  writePacket(packet: any): Promise<void>;

  query<T extends QueryResult>(sql: string): Promise<Query>;

  query<T extends QueryResult>(sql: string, values: any): Promise<Query>;

  query<T extends QueryResult>(options: QueryOptions): Promise<Query>;

  query<T extends QueryResult>(options: QueryOptions, values: any): Promise<Query>;

  query<T extends QueryResult>(options: string | QueryOptions, values: any): Promise<Query>;

  execute<T extends QueryResult>(sql: string): Promise<Query>;

  execute<T extends QueryResult>(sql: string, values: any): Promise<Query>;

  execute<T extends QueryResult>(options: QueryOptions): Promise<Query>;

  execute<T extends QueryResult>(options: string | QueryOptions, values: any): Promise<Query>;
}
