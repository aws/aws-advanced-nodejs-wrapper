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

import { SqlIdentifierUtils } from "../../common/lib/utils/sql_identifier_utils";
import { MySQLDatabaseDialect } from "../../mysql/lib/dialect/mysql_database_dialect";
import { PgDatabaseDialect } from "../../pg/lib/dialect/pg_database_dialect";

describe("test sql identifier utils", () => {
  it.each([
    ["mydb", "`mydb`"],
    ["`mydb`", "`mydb`"],
    ["my`db", "`my``db`"],
    ["`my``db`", "`my``db`"],
    ["`a` `b`", "```a`` ``b```"],
    ["db; DROP TABLE t", "`db; DROP TABLE t`"]
  ])("quote %s", (identifier: string, expected: string) => {
    expect(SqlIdentifierUtils.quote(identifier, "`")).toEqual(expected);
  });

  it.each([
    // Plain names stay unquoted so the server folds their case as before.
    ["myschema", "myschema"],
    ["MySchema", "MySchema"],
    ["schema_1$", "schema_1$"],
    // Lists stay lists.
    ["schema1, schema2", "schema1, schema2"],
    ["schema1,schema2", "schema1, schema2"],
    ['"$user", public', '"$user", public'],
    // Already-quoted elements pass through, including commas inside quotes.
    ['"MySchema"', '"MySchema"'],
    ['"a,b", c', '"a,b", c'],
    ['"a""b"', '"a""b"'],
    // Anything else is quoted, so it cannot change the statement.
    ["my schema", '"my schema"'],
    ["x; DROP TABLE t", '"x; DROP TABLE t"'],
    ['x"; DROP TABLE t; --', '"x""; DROP TABLE t; --"'],
    ['"unterminated', '"""unterminated"']
  ])("quoteListIfNeeded %s", (identifiers: string, expected: string) => {
    expect(SqlIdentifierUtils.quoteListIfNeeded(identifiers, '"')).toEqual(expected);
  });
});

describe("test set schema and catalog queries", () => {
  it("pg keeps search path semantics", () => {
    const dialect = new PgDatabaseDialect();
    expect(dialect.getSetSchemaQuery("MySchema")).toEqual("SET search_path TO MySchema");
    expect(dialect.getSetSchemaQuery("schema1, schema2")).toEqual("SET search_path TO schema1, schema2");
    expect(dialect.getSetSchemaQuery('"$user", public')).toEqual('SET search_path TO "$user", public');
    expect(dialect.getSetSchemaQuery("x; DROP TABLE t")).toEqual('SET search_path TO "x; DROP TABLE t"');
  });

  it("mysql quotes the catalog", () => {
    const dialect = new MySQLDatabaseDialect();
    expect(dialect.getSetCatalogQuery("testSessionState")).toEqual("USE `testSessionState`");
    expect(dialect.getSetCatalogQuery("db; DROP TABLE t")).toEqual("USE `db; DROP TABLE t`");
  });
});
