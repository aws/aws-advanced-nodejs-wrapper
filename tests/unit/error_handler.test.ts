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
import { AwsWrapperError } from "../../common/lib/utils/errors";

function errorWith(props: Record<string, any>): Error {
  return Object.assign(new Error("test"), props);
}

function asAwsWrapperError(error: Error): Error {
  return new AwsWrapperError(error.message, error);
}

describe("test read only connection error", () => {
  // mysql2 errors reach the plugins wrapped by ClientUtils, keeping the driver error as `cause`.
  describe("mysql", () => {
    const handler = new MySQLErrorHandler();

    it("test read only errno 1290 detected", () => {
      expect(handler.isReadOnlyConnectionError(asAwsWrapperError(errorWith({ errno: 1290 })))).toBe(true);
    });

    it("test read only errno 1836 detected", () => {
      expect(handler.isReadOnlyConnectionError(asAwsWrapperError(errorWith({ errno: 1836 })))).toBe(true);
    });

    it("test unrelated errno not detected", () => {
      expect(handler.isReadOnlyConnectionError(asAwsWrapperError(errorWith({ errno: 1064 })))).toBe(false);
    });

    it("test error without errno not detected", () => {
      expect(handler.isReadOnlyConnectionError(asAwsWrapperError(new Error("read only")))).toBe(false);
    });

    it("test read only errno detected on an unwrapped error", () => {
      expect(handler.isReadOnlyConnectionError(errorWith({ errno: 1290 }))).toBe(true);
    });
  });

  // pg hands the driver error to the plugins as-is.
  describe("pg", () => {
    const handler = new PgErrorHandler();

    it("test read only sqlstate detected", () => {
      expect(handler.isReadOnlyConnectionError(errorWith({ code: "25006" }))).toBe(true);
    });

    it("test unrelated sqlstate not detected", () => {
      expect(handler.isReadOnlyConnectionError(errorWith({ code: "42601" }))).toBe(false);
    });

    it("test error without sqlstate not detected", () => {
      expect(handler.isReadOnlyConnectionError(new Error("cannot execute INSERT in a read-only transaction"))).toBe(false);
    });

    it("test read only sqlstate detected on a wrapped error", () => {
      expect(handler.isReadOnlyConnectionError(asAwsWrapperError(errorWith({ code: "25006" })))).toBe(true);
    });
  });
});
