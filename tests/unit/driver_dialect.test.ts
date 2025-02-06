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

import { mock } from "ts-mockito";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { HostInfo } from "../../common/lib/host_info";
import { UnsupportedMethodError } from "../../common/lib/utils/errors";
import { NodePostgresDriverDialect } from "../../pg/lib/dialect/node_postgres_driver_dialect";

const mockHostInfo: HostInfo = mock(HostInfo);
const emptyProps: Map<string, any> = new Map<string, any>();

describe("driverDialectTest", () => {
  it("test_connectWithKeepAliveProps_MySQL_shouldThrow", async () => {
    const keepAliveProps = new Map<string, any>([
      ["keepAlive", true],
      ["keepAliveInitialDelayMillis", 1234]
    ]);

    const props = new Map<string, any>([["wrapperKeepAliveProperties", keepAliveProps]]);

    const dialect = new MySQL2DriverDialect();
    const unsupportedError = new UnsupportedMethodError("Keep alive configuration is not supported for MySQL2.");

    await expect(dialect.connect(mockHostInfo, props)).rejects.toThrow(unsupportedError);

    const keepAliveObj = {
      keepAlive: true,
      keepAliveInitialDelayMillis: 1234
    };

    const propsWithObj = new Map<string, any>([["wrapperKeepAliveProperties", keepAliveObj]]);

    await expect(dialect.connect(mockHostInfo, propsWithObj)).rejects.toThrow(unsupportedError);
  });

  it("test_connectWithKeepAliveProps_PG_shouldSucceed", async () => {
    const keepAliveMap = new Map<string, any>([
      ["keepAlive", true],
      ["keepAliveInitialDelayMillis", 1234]
    ]);

    const dialect = new NodePostgresDriverDialect();

    dialect.setKeepAliveProperties(emptyProps, keepAliveMap);
    expect(emptyProps.get("keepAlive")).toBe(true);
    expect(emptyProps.get("keepAliveInitialDelayMillis")).toBe(1234);

    emptyProps.clear();

    const keepAliveObj = {
      keepAlive: true,
      keepAliveInitialDelayMillis: 1234
    };

    dialect.setKeepAliveProperties(emptyProps, keepAliveObj);
    expect(emptyProps.get("keepAlive")).toBe(true);
    expect(emptyProps.get("keepAliveInitialDelayMillis")).toBe(1234);
  });
});
