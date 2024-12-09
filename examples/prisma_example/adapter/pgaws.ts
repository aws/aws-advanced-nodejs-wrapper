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

import type {
  ColumnType,
  ConnectionInfo,
  DriverAdapter,
  Query,
  Queryable,
  Result,
  ResultSet,
  Transaction,
  TransactionContext,
  TransactionOptions
} from "@prisma/driver-adapter-utils";
import { Error, ok, err } from "@prisma/driver-adapter-utils";
import { AwsPGClient } from "aws-advanced-nodejs-wrapper/dist/pg/lib/index.js";
import { fieldToColumnType, UnsupportedNativeDataType } from "./conversion";

class AwsQueryable<ClientT extends AwsPGClient> implements Queryable {
  readonly provider = "postgres";

  constructor(protected readonly client: ClientT) {}

  /**
   * Execute a query given as SQL.
   */
  async queryRaw(query: Query): Promise<Result<ResultSet>> {
    const result = await this.performIO(query);
    const fields = result?.fields;
    let rows: Array<Array<unknown>> = [];
    for (const row of result.rows) {
      const temp = [];
      for (const key in row) {
        temp.push(row[key]);
      }
      rows.push(temp);
    }
    rows = rows as ResultSet["rows"];

    const columnNames: Array<string> = fields.map((field) => field.name);

    try {
      const columnTypes: Array<ColumnType> = fields.map((field) => fieldToColumnType(field.dataTypeID));
      return ok({
        columnNames,
        columnTypes,
        rows: rows
      });
    } catch (e) {
      if (e instanceof UnsupportedNativeDataType) {
        return err({
          kind: "UnsupportedNativeDataType",
          type: e.type
        });
      }
      throw e;
    }
  }

  /**
   * Execute a query given as SQL, returning the number of returned rows.
   * Other adapters will return the number of affected rows, this can differ.
   */
  async executeRaw(query: Query): Promise<Result<number>> {
    return ok((await this.performIO(query)).rowCount);
  }

  /**
   * Run a query against the database, returning the result set.
   */
  private async performIO(query: Query) {
    const { sql, args: values } = query;

    try {
      // These terms will throw an error when passed to the client.
      return await this.client.query(sql.split("LIMIT")[0].split("OFFSET")[0]);
    } catch (e) {
      throw e as Error;
    }
  }
}

// The following are not fully implemented for desired behaviour.
class AwsTransaction extends AwsQueryable<AwsPGClient> implements Transaction {
  constructor(
    client: AwsPGClient,
    readonly options: TransactionOptions
  ) {
    super(client);
  }

  async commit(): Promise<Result<void>> {
    return Promise.resolve(ok(undefined));
  }

  async rollback(): Promise<Result<void>> {
    this.client.rollback();
    return Promise.resolve(ok(undefined));
  }
}

class AwsTransactionContext extends AwsQueryable<AwsPGClient> implements TransactionContext {
  constructor(readonly conn: AwsPGClient) {
    super(conn);
  }

  async startTransaction(): Promise<Result<Transaction>> {
    const options: TransactionOptions = {
      usePhantomQuery: false
    };

    return ok(new AwsTransaction(this.client, options));
  }
}

export type PrismaAwsOptions = {
  schema?: string;
};

export class PrismaAws extends AwsQueryable<AwsPGClient> implements DriverAdapter {
  constructor(
    client: AwsPGClient,
    private options?: PrismaAwsOptions
  ) {
    if (!(client instanceof AwsPGClient)) {
      throw new TypeError("PrismaAws must be initialized with an AwsPgClient");
    }
    super(client);
  }

  getConnectionInfo(): Result<ConnectionInfo> {
    return ok({
      schemaName: this.options?.schema
    });
  }

  async transactionContext(): Promise<Result<TransactionContext>> {
    return ok(new AwsTransactionContext(this.client));
  }
}
