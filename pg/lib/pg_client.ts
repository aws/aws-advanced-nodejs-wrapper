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

export interface PGClient {
  connect(): Promise<void>;

  end(): Promise<void>;

  // Query methods
  query(text: string): Promise<QueryResult>;

  query(text: string, values: any[]): Promise<QueryResult>;

  query(config: QueryConfig): Promise<QueryResult>;

  // Array mode queries
  query(config: QueryArrayConfig): Promise<QueryArrayResult>;

  query(config: string | QueryConfig | QueryArrayConfig, values?: any[]): Promise<QueryResult | QueryArrayResult>;

  // Copy methods
  copyFrom(queryText: string): Promise<NodeJS.WritableStream>;

  copyTo(queryText: string): Promise<NodeJS.ReadableStream>;

  // Prepared statements
  prepare(name: string, text: string, nParams?: number): Promise<void>;

  // Escape methods
  escapeIdentifier(str: string): Promise<string>;

  escapeLiteral(str: string): Promise<string>;
}
