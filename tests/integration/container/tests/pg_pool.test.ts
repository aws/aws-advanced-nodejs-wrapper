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

import { features } from "./config";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { logger } from "../../../../common/logutils";
import { TestEnvironment } from "./utils/test_environment";
import { PluginManager } from "../../../../common/lib";
import { DriverHelper } from "./utils/driver_helper";
import { AwsPoolConfig } from "../../../../common/lib/aws_pool_config";
import { FailoverSuccessError, TransactionResolutionUnknownError } from "../../../../common/lib/utils/errors";
import { AuroraTestUtility } from "./utils/aurora_test_utility";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) && !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) ? it : it.skip;

const itIfPG = !features.includes(TestEnvironmentFeatures.SKIP_PG_DRIVER_TESTS) ? itIf : it.skip;

let env: TestEnvironment;
let client: any;
let auroraTestUtility: AuroraTestUtility;

async function createPool(plugins: string = "efm2,failover2"): Promise<any> {
  const env = await TestEnvironment.getCurrent();
  const props = {
    user: env.databaseInfo.username,
    host: env.databaseInfo.instances[0].host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: env.databaseInfo.instanceEndpointPort,
    plugins
  };

  const poolConfig = new AwsPoolConfig({
    maxConnections: 10,
    maxIdleConnections: 3,
    idleTimeoutMillis: 300000
  });

  const configuredProps = DriverHelper.addDriverSpecificConfiguration(props, env.engine);
  const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
  return DriverHelper.getPoolClient(driver)(configuredProps, poolConfig);
}

beforeEach(async () => {
  logger.info(`Test started: ${expect.getState().currentTestName}`);
  env = await TestEnvironment.getCurrent();
  auroraTestUtility = new AuroraTestUtility(env.region);
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

describe("pg pool integration tests", () => {
  itIfPG("concurrent execution", async () => {
    client = await createPool();

    const queries = Array.from({ length: 10 }, (_, i) => client.query("SELECT $1::int as query_id, pg_backend_pid() as connection_id", [i + 1]));

    const results = await Promise.all(queries);

    expect(results).toHaveLength(10);

    const connectionIds = new Set();
    results.forEach((result, index) => {
      expect(result.rows[0].query_id).toBe(index + 1);
      connectionIds.add(result.rows[0].connection_id);
    });

    expect(connectionIds.size).toBe(10);
  });

  itIfPG("sequential execution", async () => {
    client = await createPool();

    const results = [];
    const connectionIds = new Set();

    for (let i = 0; i < 10; i++) {
      const result = await client.query("SELECT $1::int as query_id, pg_backend_pid() as connection_id", [i + 1]);
      results.push(result);
      connectionIds.add(result.rows[0].connection_id);
    }

    expect(results).toHaveLength(10);
    results.forEach((result, index) => {
      expect(result.rows[0].query_id).toBe(index + 1);
    });

    expect(connectionIds.size).toBeLessThanOrEqual(10);
  });

  itIfPG("failover writer during concurrent query execution", async () => {
    client = await createPool();

    const initialWriterId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

    // Crash instance 1 and nominate a new writer.
    await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

    await expect(async () => {
      await auroraTestUtility.queryInstanceId(client);
    }).rejects.toThrow(FailoverSuccessError);

    // Assert that we are connected to the new writer after failover happens.
    const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
    expect(currentConnectionId).not.toBe(initialWriterId);
  });

  itIfPG("failover writer during multi-statement transaction", async () => {
    client = await createPool();

    const initialWriterId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

    const poolClient = await client.connect();
    await poolClient.query("BEGIN");
    await poolClient.query("CREATE TEMP TABLE test_table (id INT, name TEXT)");
    await poolClient.query("INSERT INTO test_table VALUES (1, $1)", ["test"]);

    // Crash instance 1 and nominate a new writer.
    await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

    await expect(async () => {
      await auroraTestUtility.queryInstanceId(client);
    }).rejects.toThrow(TransactionResolutionUnknownError);

    // Assert that we are connected to the new writer after failover happens.
    const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
    expect(currentConnectionId).not.toBe(initialWriterId);

    await expect(async () => {
      await client.query("SELECT * FROM test_table WHERE id = 1");
    }).rejects.toThrow();
  });

  itIfPG(
    "separate sequential transactions on different pool clients",
    async () => {
      client = await createPool();

      const poolClient1 = await client.connect();
      const poolClient2 = await client.connect();

      await poolClient1.query("BEGIN");
      await poolClient2.query("BEGIN");

      await poolClient1.query("CREATE TEMP TABLE pg_test_table1 (id INT, value VARCHAR(50))");
      await poolClient1.query("INSERT INTO pg_test_table1 VALUES (1, 'client1')");

      await poolClient2.query("CREATE TEMP TABLE pg_test_table2 (id INT, value VARCHAR(50))");
      await poolClient2.query("INSERT INTO pg_test_table2 VALUES (1, 'client2')");

      const result1 = await poolClient1.query("SELECT * FROM pg_test_table1");
      expect(result1.rows[0].value).toBe("client1");

      const result2 = await poolClient2.query("SELECT * FROM pg_test_table2");
      expect(result2.rows[0].value).toBe("client2");

      await expect(async () => {
        await poolClient1.query("SELECT * FROM pg_test_table2");
      }).rejects.toThrow();

      await expect(async () => {
        await poolClient2.query("SELECT * FROM pg_test_table1");
      }).rejects.toThrow();

      await poolClient1.query("COMMIT");
      await poolClient2.query("COMMIT");

      poolClient1.release();
      poolClient2.release();
    },
    1320000
  );

  itIfPG(
    "separate concurrent transactions on different pool clients",
    async () => {
      client = await createPool();

      const poolClient1 = await client.connect();
      const poolClient2 = await client.connect();

      await Promise.all([poolClient1.query("BEGIN"), poolClient2.query("BEGIN")]);

      await Promise.all([
        poolClient1.query("CREATE TEMP TABLE pg_test_table1 (id INT, value VARCHAR(50))"),
        poolClient2.query("CREATE TEMP TABLE pg_test_table2 (id INT, value VARCHAR(50))")
      ]);

      await Promise.all([
        poolClient1.query("INSERT INTO pg_test_table1 VALUES (1, 'client1')"),
        poolClient2.query("INSERT INTO pg_test_table2 VALUES (1, 'client2')")
      ]);

      const [result1, result2] = await Promise.all([
        poolClient1.query("SELECT * FROM pg_test_table1"),
        poolClient2.query("SELECT * FROM pg_test_table2")
      ]);

      expect(result1.rows[0].value).toBe("client1");
      expect(result2.rows[0].value).toBe("client2");

      await Promise.all([
        expect(poolClient1.query("SELECT * FROM pg_test_table2")).rejects.toThrow(),
        expect(poolClient2.query("SELECT * FROM pg_test_table1")).rejects.toThrow()
      ]);

      await Promise.all([poolClient1.query("COMMIT"), poolClient2.query("COMMIT")]);

      poolClient1.release();
      poolClient2.release();
    },
    1320000
  );
});
