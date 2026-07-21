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

import { MySQLErrorHandler } from "../../mysql/lib/mysql_error_handler";
import { PgErrorHandler } from "../../pg/lib/pg_error_handler";

function errorWith(props: Record<string, any>): Error {
  return Object.assign(new Error("test"), props);
}

describe("test read only connection error", () => {
  const pgHandler = new PgErrorHandler();
  const mysqlHandler = new MySQLErrorHandler();

  it("test pg read only detected by sqlstate 25006", () => {
    expect(pgHandler.isReadOnlyConnectionError(errorWith({ code: "25006" }))).toBe(true);
  });

  it("test pg unrelated sqlstate not detected", () => {
    expect(pgHandler.isReadOnlyConnectionError(errorWith({ code: "42601" }))).toBe(false);
  });

  it("test pg error without code not detected", () => {
    expect(pgHandler.isReadOnlyConnectionError(new Error("cannot execute in a read-only transaction"))).toBe(false);
  });

  it("test mysql read only detected by errno 1290", () => {
    expect(mysqlHandler.isReadOnlyConnectionError(errorWith({ errno: 1290 }))).toBe(true);
  });

  it("test mysql read only detected by errno 1836", () => {
    expect(mysqlHandler.isReadOnlyConnectionError(errorWith({ errno: 1836 }))).toBe(true);
  });

  it("test mysql unrelated errno not detected", () => {
    expect(mysqlHandler.isReadOnlyConnectionError(errorWith({ errno: 1064 }))).toBe(false);
  });

  it("test mysql error without errno not detected", () => {
    expect(mysqlHandler.isReadOnlyConnectionError(new Error("read only"))).toBe(false);
  });
});
