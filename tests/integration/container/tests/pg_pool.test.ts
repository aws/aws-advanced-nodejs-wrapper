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

import { features, instanceCount } from "./config";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { logger } from "../../../../common/logutils";
import { TestEnvironment } from "./utils/test_environment";
import { PluginManager } from "../../../../common/lib";
import { DriverHelper } from "./utils/driver_helper";
import { AwsPoolConfig } from "../../../../common/lib/aws_pool_config";
import { FailoverSuccessError, TransactionResolutionUnknownError } from "../../../../common/lib/utils/errors";
import { AuroraTestUtility } from "./utils/aurora_test_utility";
import { sleep } from "../../../../common/lib/utils/utils";
import { InternalPooledConnectionProvider } from "../../../../common/lib/internal_pooled_connection_provider";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) && !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) ? it : it.skip;

const itIfPG = !features.includes(TestEnvironmentFeatures.SKIP_PG_DRIVER_TESTS) ? itIf : it.skip;
const itIfPGTwoInstances = instanceCount >= 2 ? itIfPG : it.skip;

let env: TestEnvironment;
let client: any;
let provider: any;
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

async function createPoolWithICP(plugins: string = "efm2,failover2"): Promise<any> {
  const env = await TestEnvironment.getCurrent();
  const poolConfig = new AwsPoolConfig({
    maxConnections: 10,
    maxIdleConnections: 3,
    idleTimeoutMillis: 300000
  });
  provider = new InternalPooledConnectionProvider(poolConfig);
  const props = {
    user: env.databaseInfo.username,
    host: env.databaseInfo.instances[0].host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: env.databaseInfo.instanceEndpointPort,
    plugins,
    connectionProvider: provider
  };
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
}, 1320000);

afterEach(async () => {
  if (client !== null) {
    try {
      await client.end();
      await PluginManager.releaseResources();
    } catch (error) {
      // Do nothing
    }
  }
  if (provider != null) {
    try {
      await provider.releaseResources();
    } catch (error) {
      // Do nothing
    }
  }
  await PluginManager.releaseResources();
  logger.info(`Test finished: ${expect.getState().currentTestName}`);
}, 1320000);

const poolFactories = [
  { name: "createPool", factory: createPool },
  { name: "createPoolWithICP", factory: createPoolWithICP }
];

describe("pg pool integration tests", () => {
  poolFactories.forEach(({ name, factory }) => {
    describe(`using ${name}`, () => {
      itIfPG("concurrent execution", async () => {
        client = await factory();
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
        client = await factory();
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

      itIfPGTwoInstances("failover writer during multi-statement transaction", async () => {
        client = await factory();
        const initialWriterId = await auroraTestUtility.queryInstanceId(client);
        expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

        const poolClient = await client.connect();
        try {
          await poolClient.query("BEGIN");
          await poolClient.query("CREATE TEMP TABLE test_table (id INT, name TEXT)");
          await poolClient.query("INSERT INTO test_table VALUES (1, $1)", ["test"]);

          await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

          await expect(async () => {
            await auroraTestUtility.queryInstanceId(poolClient);
          }).rejects.toThrow(TransactionResolutionUnknownError);

          const currentConnectionId = await auroraTestUtility.queryInstanceId(poolClient);
          expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
          expect(currentConnectionId).not.toBe(initialWriterId);

          await expect(async () => {
            await client.query("SELECT * FROM test_table WHERE id = 1");
          }).rejects.toThrow();
        } finally {
          await poolClient.release();
        }
      });

      itIfPGTwoInstances("failover writer during idle", async () => {
        const clients: any[] = [];
        client = await factory();
        const initialWriterId = await auroraTestUtility.queryInstanceId(client);
        expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

        for (let i = 0; i < 10; i++) {
          clients.push(await client.connect());
        }

        await sleep(15000);
        await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged(initialWriterId);

        for (const poolClient of clients) {
          await expect(async () => {
            await auroraTestUtility.queryInstanceId(poolClient);
          }).rejects.toThrow(FailoverSuccessError);
        }

        for (const poolClient of clients) {
          const currentConnectionId = await auroraTestUtility.queryInstanceId(poolClient);
          expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
          expect(currentConnectionId).not.toBe(initialWriterId);
          poolClient.release();
        }

        const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
        expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
        expect(currentConnectionId).not.toBe(initialWriterId);
      });

      itIfPG(
        "separate sequential transactions on different pool clients",
        async () => {
          const clients: any[] = [];
          client = await factory();

          const poolClient1 = await client.connect();
          const poolClient2 = await client.connect();
          clients.push(poolClient1, poolClient2);

          try {
            for (const poolClient of clients) {
              await poolClient.query("BEGIN");
            }

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

            for (const poolClient of clients) {
              await poolClient.query("COMMIT");
            }
          } finally {
            for (const poolClient of clients) {
              await poolClient.release();
            }
          }
        },
        1320000
      );

      itIfPG(
        "separate concurrent transactions on different pool clients",
        async () => {
          const clients: any[] = [];
          client = await factory();

          const poolClient1 = await client.connect();
          const poolClient2 = await client.connect();
          clients.push(poolClient1, poolClient2);

          try {
            for (const poolClient of clients) {
              await poolClient.query("BEGIN");
            }

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

            for (const poolClient of clients) {
              await poolClient.query("COMMIT");
            }
          } finally {
            for (const poolClient of clients) {
              await poolClient.release();
            }
          }
        },
        1320000
      );
    });
  });
});
