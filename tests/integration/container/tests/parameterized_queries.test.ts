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

import { TestEnvironment } from "./utils/test_environment";
import { DriverHelper } from "./utils/driver_helper";
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features } from "./config";
import { PluginManager } from "../../../../common/lib";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) && !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) ? it : it.skip;

const itIfMySQL = !features.includes(TestEnvironmentFeatures.SKIP_MYSQL_DRIVER_TESTS) ? itIf : it.skip;
const itIfPG = !features.includes(TestEnvironmentFeatures.SKIP_PG_DRIVER_TESTS) ? itIf : it.skip;

let client: any;

async function createConnection(plugins: string = "failover"): Promise<any> {
  const env = await TestEnvironment.getCurrent();
  const props = {
    user: env.databaseInfo.username,
    host: env.databaseInfo.instances[0].host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: env.databaseInfo.instanceEndpointPort,
    plugins
  };
  const configuredProps = DriverHelper.addDriverSpecificConfiguration(props, env.engine);
  const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
  const newClient = DriverHelper.getClient(driver)(configuredProps);
  await newClient.connect();
  return newClient;
}

beforeEach(async () => {
  logger.info(`Test started: ${expect.getState().currentTestName}`);
  await TestEnvironment.verifyClusterStatus();
  client = null;
}, 60000);

afterEach(async () => {
  if (client !== null) {
    try {
      await client.end();
    } catch (error) {
      // pass
    }
  }
  await PluginManager.releaseResources();
  logger.info(`Test finished: ${expect.getState().currentTestName}`);
}, 60000);

describe("parameterized_queries", () => {
  itIfMySQL(
    "mysql parameterized query with values array",
    async () => {
      client = await createConnection();

      const [result] = await client.query("SELECT ? as value, ? as name", [42, "test"]);
      expect(result[0].value).toBe(42);
      expect(result[0].name).toBe("test");
    },
    60000
  );

  itIfMySQL(
    "mysql parameterized query with QueryOptions",
    async () => {
      client = await createConnection();

      const [result] = await client.query({
        sql: "SELECT ? as value, ? as name",
        values: [123, "param_test"]
      });
      expect(result[0].value).toBe(123);
      expect(result[0].name).toBe("param_test");
    },
    60000
  );

  itIfMySQL(
    "mysql execute with parameters",
    async () => {
      client = await createConnection();

      const [result] = await client.execute("SELECT ? as value", [999]);
      expect(result[0].value).toBe(999);
    },
    60000
  );

  itIfMySQL(
    "mysql parameterized autocommit setting",
    async () => {
      client = await createConnection();

      await client.query("SET autocommit=?", [0]);
      expect(client.getAutoCommit()).toBe(false);

      await client.query("SET autocommit=?", [1]);
      expect(client.getAutoCommit()).toBe(true);
    },
    60000
  );

  itIfMySQL(
    "mysql parameterized transaction operations",
    async () => {
      client = await createConnection();

      await client.query("SET autocommit=?", [0]);
      expect(client.getAutoCommit()).toBe(false);

      await client.query("START TRANSACTION");
      const [result] = await client.query("SELECT ? as test_value", [42]);
      expect(result[0].test_value).toBe(42);

      await client.query("COMMIT");
      await client.query("SET autocommit=?", [1]);
      expect(client.getAutoCommit()).toBe(true);
    },
    60000
  );

  itIfPG(
    "pg parameterized query",
    async () => {
      client = await createConnection();

      const result = await client.query("SELECT $1::int as value, $2::text as name", [42, "test"]);
      expect(result.rows[0].value).toBe(42);
      expect(result.rows[0].name).toBe("test");
    },
    60000
  );

  itIfPG(
    "pg parameterized query with config",
    async () => {
      client = await createConnection();

      // Test QueryConfig
      let result = await client.query({
        text: "SELECT $1::int as value, $2::text as name",
        values: [123, "param_test"]
      });
      expect(result.rows[0].value).toBe(123);
      expect(result.rows[0].name).toBe("param_test");

      // Test QueryArrayConfig
      result = await client.query({
        text: "SELECT name, age FROM users WHERE id = $1",
        values: [1],
        rowMode: "array"
      });

      expect(result.rows[0].value).toBe(123);
      expect(result.rows[0].name).toBe("param_test");

      // 5. Named parameters using QueryConfig
      result = await client.query({
        name: "fetch-user",
        text: "SELECT * FROM users WHERE id = $1",
        values: [1]
      });
    },
    60000
  );
});
