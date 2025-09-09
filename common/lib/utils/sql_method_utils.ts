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

import { DatabaseDialect } from "../database_dialect/database_dialect";
import { TransactionIsolationLevel } from "./transaction_isolation_level";
import { DriverDialect } from "../driver_dialect/driver_dialect";

export class SqlMethodUtils {
  static doesOpenTransaction(sql: string) {
    const firstStatement = SqlMethodUtils.getFirstSqlStatement(sql);
    if (!firstStatement) {
      return false;
    }
    return firstStatement.toLowerCase().startsWith("start transaction") || firstStatement.toLowerCase().startsWith("begin");
  }

  static doesCloseTransaction(sql: string) {
    const firstStatement = SqlMethodUtils.getFirstSqlStatement(sql);
    if (!firstStatement) {
      return false;
    }
    return (
      firstStatement.toLowerCase().startsWith("commit") ||
      firstStatement.toLowerCase().startsWith("rollback") ||
      firstStatement.toLowerCase().startsWith("end") ||
      firstStatement.toLowerCase().startsWith("abort")
    );
  }

  static doesSetReadOnly(statements: string[], dialect: DatabaseDialect): boolean | undefined {
    let readOnly;
    for (const statement of statements) {
      const cleanStatement = statement
        .toLowerCase()
        .replaceAll(/\s*\/\*(.*?)\*\/\s*/gi, " ")
        .trim();
      readOnly = dialect.doesStatementSetReadOnly(cleanStatement) ?? readOnly;
    }

    return readOnly;
  }

  static doesSetAutoCommit(statements: string[], dialect: DatabaseDialect): boolean | undefined {
    let autoCommit = undefined;
    for (const statement of statements) {
      const cleanStatement = statement
        .toLowerCase()
        .replaceAll(/\s*\/\*(.*?)\*\/\s*/gi, " ")
        .trim();
      autoCommit = dialect.doesStatementSetAutoCommit(cleanStatement) ?? autoCommit;
    }

    return autoCommit;
  }

  static doesSetCatalog(statements: string[], dialect: DatabaseDialect): string | undefined {
    let catalog = undefined;
    for (const statement of statements) {
      const cleanStatement = statement
        .toLowerCase()
        .replaceAll(/\s*\/\*(.*?)\*\/\s*/gi, " ")
        .trim();
      catalog = dialect.doesStatementSetCatalog(cleanStatement) ?? catalog;
    }

    return catalog;
  }

  static doesSetSchema(statements: string[], dialect: DatabaseDialect): string | undefined {
    let schema = undefined;
    for (const statement of statements) {
      const cleanStatement = statement
        .toLowerCase()
        .replaceAll(/\s*\/\*(.*?)\*\/\s*/gi, " ")
        .trim();
      schema = dialect.doesStatementSetSchema(cleanStatement) ?? schema;
    }

    return schema;
  }

  static doesSetTransactionIsolation(statements: string[], dialect: DatabaseDialect): TransactionIsolationLevel | undefined {
    let transactionIsolation = undefined;
    for (const statement of statements) {
      const cleanStatement = statement
        .toLowerCase()
        .replaceAll(/\s*\/\*(.*?)\*\/\s*/gi, " ")
        .trim();
      transactionIsolation = dialect.doesStatementSetTransactionIsolation(cleanStatement) ?? transactionIsolation;
    }

    return transactionIsolation;
  }

  static getFirstSqlStatement(sql: string) {
    const statements = SqlMethodUtils.parseMultiStatementQueries(sql);
    if (statements.length === 0) {
      return sql;
    }

    const statement = statements[0];
    return statement
      .toLowerCase()
      .replaceAll(/\s*\/\*(.*?)\*\/\s*/gi, " ")
      .trim();
  }

  static parseMultiStatementQueries(sql: string): string[] {
    if (!sql) {
      return [];
    }

    const query = sql.replaceAll(/\s+/gi, " ");
    if (!query.trim()) {
      return [];
    }

    return sql.split(";");
  }

  static parseMethodArgs(methodArgs: any, driverDialect: DriverDialect) {
    // MethodArgs may be an array, where the first element could be either a string, a MySQL2 Query Object, or a Node-Postgres config object.
    if (!methodArgs) {
      return methodArgs;
    }
    if (!Array.isArray(methodArgs)) {
      return driverDialect.getQueryFromMethodArg(methodArgs);
    }

    const statement = methodArgs[0];
    return driverDialect.getQueryFromMethodArg(statement);
  }
}
