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

import { SqlMethodUtils } from "aws-wrapper-common-lib/lib/utils/sql_method_utils";
import { MySQLDatabaseDialect } from "mysql-wrapper/lib/dialect/mysql_database_dialect";
import { PgDatabaseDialect } from "pg-wrapper/lib/dialect/pg_database_dialect";
import { TransactionIsolationLevel } from "aws-wrapper-common-lib/lib/utils/transaction_isolation_level";

describe("test sql method utils", () => {
  it.each([
    ["  bEgIn ; ", true],
    ["START TRANSACTION", true],
    ["START /* COMMENT */ TRANSACTION; SELECT 1;", true],
    ["START/* COMMENT */TRANSACTION;", true],
    ["START      /* COMMENT */    TRANSACTION;", true],
    ["START   /*COMMENT*/TRANSACTION;", true],
    ["/*COMMENT*/START   /*COMMENT*/TRANSACTION;", true],
    [" /*COMMENT*/ START   /*COMMENT*/TRANSACTION;", true],
    [" /*COMMENT*/ begin", true],
    ["commit", false],
    [" select 1", false],
    [" INSERT INTO test_table VALUES (1) ; ", false],
    [" set autocommit = 1 ", false]
  ])("test open transaction", (sql: string, expectedResult: boolean) => {
    expect(SqlMethodUtils.doesOpenTransaction(sql)).toBe(expectedResult);
  });

  it.each([
    ["rollback", true],
    ["commit", true],
    ["end", true],
    ["abort", true],
    ["select 1", false]
  ])("test close transaction", (sql: string, expectedResult: boolean) => {
    expect(SqlMethodUtils.doesCloseTransaction(sql)).toBe(expectedResult);
  });

  it.each([
    [[" select 1 "], undefined, "mysql"],
    [[" select /* COMMENT */ 1 "], undefined, "mysql"],
    [[" /* COMMENT */ select /* COMMENT */ 1 "], undefined, "mysql"],
    [[" set session transaction read only "], true, "mysql"],
    [[" set session transaction read /* COMMENT */ only "], true, "mysql"],
    [[" /* COMMENT */ set session transaction read /* COMMENT */ only "], true, "mysql"],
    [[" set session transaction read write "], false, "mysql"],
    [[" /* COMMENT */ set session transaction /* COMMENT */ read write "], false, "mysql"],
    [[" set session transaction /* COMMENT */ read write "], false, "mysql"],
    [[" set session transaction read only;", " set session transaction read write"], false, "mysql"],
    [[" set session transaction read only;", " select 1"], true, "mysql"],
    [[" set session  /* COMMENT */transaction read only/* COMMENT */;", " select 1"], true, "mysql"],
    [[" select 1;", " set session transaction read only; "], true, "mysql"],
    [[" set session transaction read only;", " set session transaction read write; "], false, "mysql"],
    [[" set session transaction read write;", " set session transaction read only; "], true, "mysql"],
    [[" set session transaction read write;", " select 1"], false, "mysql"],
    [[" select 1;", " set session transaction read write;", " select 1"], false, "mysql"],
    [[" select 1 "], undefined, "pg"],
    [[" select /* COMMENT */ 1 "], undefined, "pg"],
    [[" /* COMMENT */ select /* COMMENT */ 1 "], undefined, "pg"],
    [[" set session characteristics as transaction read only"], true, "pg"],
    [[" set session characteristics as transaction read /* COMMENT */ only "], true, "pg"],
    [[" /* COMMENT */ set session characteristics as transaction read /* COMMENT */ only "], true, "pg"],
    [[" set session characteristics as transaction read write "], false, "pg"],
    [[" /* COMMENT */ set session characteristics as transaction /* COMMENT */ read write "], false, "pg"],
    [[" set session characteristics as transaction /* COMMENT */ read write "], false, "pg"],
    [[" set session characteristics as transaction read only;", " set session characteristics as transaction read write"], false, "pg"],
    [[" set session characteristics as transaction read only;", " select 1"], true, "pg"],
    [[" set session characteristics as  /* COMMENT */transaction read only/* COMMENT */;", " select 1"], true, "pg"],
    [[" select 1;", " set session characteristics as transaction read only; "], true, "pg"],
    [[" set session characteristics as transaction read write;", " set session characteristics as transaction read only; "], true, "pg"],
    [[" set session characteristics as transaction read only;", " set session characteristics as transaction read write; "], false, "pg"],
    [[" set session characteristics as transaction read write;", " select 1"], false, "pg"],
    [[" select 1;", " set session characteristics as transaction read write;", " select 1"], false, "pg"]
  ])("test read only", (sql: string[], expectedResult: boolean | undefined, dialect: string) => {
    switch (dialect) {
      case "mysql":
        expect(SqlMethodUtils.doesSetReadOnly(sql, new MySQLDatabaseDialect())).toBe(expectedResult);
        break;
      case "pg":
        expect(SqlMethodUtils.doesSetReadOnly(sql, new PgDatabaseDialect())).toBe(expectedResult);
        break;
    }
  });

  it.each([
    [[" select 1 "], undefined],
    [[" select /* COMMENT */ 1 "], undefined],
    [[" /* COMMENT */ select /* COMMENT */ 1 "], undefined],
    [[" set autocommit = 1 "], true],
    [[" set autocommit = 0 "], false],
    [[" set autocommit=1 "], true],
    [[" set autocommit=0 "], false],
    [[" set autocommit=/* COMMENT */0 "], false],
    [[" set autocommit=1 ", " set autocommit=0 "], false],
    [[" set autocommit=0 ", " set autocommit=1 "], true]
  ])("test autoCommit", (sql: string[], expectedResult: boolean | undefined) => {
    expect(SqlMethodUtils.doesSetAutoCommit(sql, new MySQLDatabaseDialect())).toBe(expectedResult);
  });

  it.each([
    [[" select 1 "], undefined],
    [[" select /* COMMENT */ 1 "], undefined],
    [[" /* COMMENT */ select /* COMMENT */ 1 "], undefined],
    [[" set search_path to path "], "path"],
    [[" set search_path/* COMMENT */ to path "], "path"],
    [[" set search_path to path1 ", " set search_path to path2 "], "path2"]
  ])("test schema", (sql: string[], expectedResult: string | undefined) => {
    expect(SqlMethodUtils.doesSetSchema(sql, new PgDatabaseDialect())).toBe(expectedResult);
  });

  it.each([
    [[" select 1 "], undefined],
    [[" select /* COMMENT */ 1 "], undefined],
    [[" /* COMMENT */ select /* COMMENT */ 1 "], undefined],
    [[" use dbName "], "dbname"],
    [[" use/* COMMENT use dbName3*/ dbName "], "dbname"],
    [[" use dbName1 ", " use dbName2 "], "dbname2"]
  ])("test catalog", (sql: string[], expectedResult: string | undefined) => {
    expect(SqlMethodUtils.doesSetCatalog(sql, new MySQLDatabaseDialect())).toBe(expectedResult);
  });

  it.each([
    [[" select 1 "], undefined, "mysql"],
    [[" select /* COMMENT */ 1 "], undefined, "mysql"],
    [[" /* COMMENT */ select /* COMMENT */ 1 "], undefined, "mysql"],
    [[" set session transaction isolation level read uncommitted "], TransactionIsolationLevel.TRANSACTION_READ_UNCOMMITTED, "mysql"],
    [[" set session transaction isolation level read committed "], TransactionIsolationLevel.TRANSACTION_READ_COMMITTED, "mysql"],
    [[" set session transaction isolation level repeatable read "], TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ, "mysql"],
    [[" set session transaction isolation level serializable "], TransactionIsolationLevel.TRANSACTION_SERIALIZABLE, "mysql"],
    [
      [" set session transaction isolation level serializable ", " set session transaction isolation level repeatable read "],
      TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ,
      "mysql"
    ],
    [
      [
        " set session transaction /* COMMENT */isolation level read uncommitted ",
        "select 1",
        " set session transaction /* COMMENT */ isolation level read committed "
      ],
      TransactionIsolationLevel.TRANSACTION_READ_COMMITTED,
      "mysql"
    ],
    [[" select 1 "], undefined, "pg"],
    [[" select /* COMMENT */ 1 "], undefined, "pg"],
    [[" /* COMMENT */ select /* COMMENT */ 1 "], undefined, "mysql"],
    [[" set session characteristics as transaction isolation level read uncommitted "], TransactionIsolationLevel.TRANSACTION_READ_COMMITTED, "pg"],
    [[" set session characteristics as transaction isolation level read committed "], TransactionIsolationLevel.TRANSACTION_READ_COMMITTED, "pg"],
    [[" set session characteristics as transaction isolation level repeatable read "], TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ, "pg"],
    [[" set session characteristics as transaction isolation level serializable "], TransactionIsolationLevel.TRANSACTION_SERIALIZABLE, "pg"],
    [
      [
        " set session characteristics as transaction isolation level serializable ",
        " set session characteristics as transaction isolation level repeatable read "
      ],
      TransactionIsolationLevel.TRANSACTION_REPEATABLE_READ,
      "pg"
    ],
    [
      [
        " set session characteristics as transaction /* COMMENT */isolation level read uncommitted ",
        "select 1",
        " set session characteristics as transaction /* COMMENT */ isolation level read committed "
      ],
      TransactionIsolationLevel.TRANSACTION_READ_COMMITTED,
      "pg"
    ]
  ])("test catalog", (sql: string[], expectedResult: TransactionIsolationLevel | undefined, dialect: string) => {
    switch (dialect) {
      case "mysql":
        expect(SqlMethodUtils.doesSetTransactionIsolation(sql, new MySQLDatabaseDialect())).toBe(expectedResult);
        break;
      case "pg":
        expect(SqlMethodUtils.doesSetTransactionIsolation(sql, new PgDatabaseDialect())).toBe(expectedResult);
        break;
    }
  });
});
