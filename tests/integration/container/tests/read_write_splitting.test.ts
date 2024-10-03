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
import { AuroraTestUtility } from "./utils/aurora_test_utility";
import { AwsWrapperError, FailoverSuccessError } from "../../../../common/lib/utils/errors";
import { DatabaseEngine } from "./utils/database_engine";
import { QueryResult } from "pg";
import { ProxyHelper } from "./utils/proxy_helper";
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features } from "./config";

const itIf = !features.includes(TestEnvironmentFeatures.PERFORMANCE) && features.includes(TestEnvironmentFeatures.IAM) ? it : it.skip;

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;
let client: any;
let auroraTestUtility: AuroraTestUtility;

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "readWriteSplitting"
  };

  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function initConfigWithFailover(host: string, port: number, connectToProxy: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "readWriteSplitting,failover",
    failoverTimeoutMs: 400000
  };

  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

describe("aurora read write splitting", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    auroraTestUtility = new AuroraTestUtility(env.region);

    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    client = null;
    await TestEnvironment.verifyClusterStatus();
  }, 1320000);

  afterEach(async () => {
    if (client !== null) {
      try {
        await client.end();
      } catch (error) {
        // pass
      }
    }
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  it.skip("test connect to writer switch set read only", async () => {
    const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
    client = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(`event emitter threw error: ${error.message}`);
      logger.debug(error.stack);
    });

    await client.connect();
    const initialWriterId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

    await client.setReadOnly(true);
    const readerId = await auroraTestUtility.queryInstanceId(client);
    expect(readerId).not.toBe(initialWriterId);

    await client.setReadOnly(true);
    const currentId0 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId0).toStrictEqual(readerId);

    await client.setReadOnly(false);
    const currentId1 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId1).toStrictEqual(initialWriterId);

    await client.setReadOnly(false);
    const currentId2 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId2).toStrictEqual(initialWriterId);

    await client.setReadOnly(true);
    const currentId3 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId3).toStrictEqual(readerId);
    expect(await auroraTestUtility.isDbInstanceWriter(currentId3)).toStrictEqual(false);
  }, 1320000);

  itIf(
    "test set read only false in read only transaction",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      client.on("error", (error: any) => {
        logger.debug(`event emitter threw error: ${error.message}`);
        logger.debug(error.stack);
      });

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      await client.setReadOnly(true);
      const initialReaderId = await auroraTestUtility.queryInstanceId(client);
      expect(initialReaderId).not.toBe(initialWriterId);

      await DriverHelper.executeQuery(env.engine, client, "START TRANSACTION READ ONLY"); // start transaction
      await DriverHelper.executeQuery(env.engine, client, "SELECT 1");

      try {
        await client.setReadOnly(false);
      } catch (error: any) {
        logger.debug(error.message);
        if (!(error instanceof AwsWrapperError)) {
          throw new Error("Resulting error type incorrect");
        }
      }
      const currentConnectionId0 = await auroraTestUtility.queryInstanceId(client);
      expect(currentConnectionId0).toStrictEqual(initialReaderId);

      await DriverHelper.executeQuery(env.engine, client, "COMMIT");

      await client.setReadOnly(false);
      const currentConnectionId1 = await auroraTestUtility.queryInstanceId(client);
      expect(currentConnectionId1).toStrictEqual(initialWriterId);
    },
    1320000
  );

  itIf(
    "test set read only true in transaction",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      client.on("error", (error: any) => {
        logger.debug(`event emitter threw error: ${error.message}`);
        logger.debug(error.stack);
      });

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      await DriverHelper.executeQuery(env.engine, client, "DROP TABLE IF EXISTS test3_3");
      await DriverHelper.executeQuery(env.engine, client, "CREATE TABLE test3_3 (id int not null primary key, test3_3_field varchar(255) not null)");

      await DriverHelper.executeQuery(env.engine, client, "START TRANSACTION"); // start transaction
      await DriverHelper.executeQuery(env.engine, client, "INSERT INTO test3_3 VALUES (1, 'test field string 1')");

      await client.setReadOnly(true);
      const currentReaderId = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId).toStrictEqual(initialWriterId);

      await DriverHelper.executeQuery(env.engine, client, "COMMIT");

      // Assert that 1 row has been inserted to the table.
      const result = await DriverHelper.executeQuery(env.engine, client, "SELECT count(*) from test3_3");
      if (env.engine === DatabaseEngine.PG) {
        expect((result as QueryResult).rows[0]["count"]).toBe("1");
      } else if (env.engine === DatabaseEngine.MYSQL) {
        expect(JSON.parse(JSON.stringify(result))[0][0]["count(*)"]).toBe(1);
      }
      await client.setReadOnly(false);
      const currentConnectionId1 = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId1)).toStrictEqual(true);
      expect(currentConnectionId1).toStrictEqual(initialWriterId);

      await DriverHelper.executeQuery(env.engine, client, "DROP TABLE IF EXISTS test3_3");
    },
    1320000
  );

  itIf(
    "test set read only all instances down",
    async () => {
      const config = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);
      client = initClientFunc(config);

      client.on("error", (error: any) => {
        logger.debug(`event emitter threw error: ${error.message}`);
        logger.debug(error.stack);
      });

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      await client.setReadOnly(true);
      const currentReaderId0 = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId0).not.toBe(initialWriterId);

      // Kill all instances
      await ProxyHelper.disableAllConnectivity(env.engine);
      await expect(async () => {
        await client.setReadOnly(false);
      }).rejects.toThrow();
    },
    1320000
  );

  itIf(
    "test set read only all readers down",
    async () => {
      const config = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);

      client = initClientFunc(config);

      client.on("error", (error: any) => {
        logger.debug(`event emitter threw error: ${error.message}`);
        logger.debug(error.stack);
      });

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      // Kill all reader instances
      for (const host of env.proxyDatabaseInfo.instances) {
        if (host.instanceId && host.instanceId !== initialWriterId) {
          await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
        }
      }

      await client.setReadOnly(true);
      const currentReaderId0 = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId0).toStrictEqual(initialWriterId);

      await client.setReadOnly(false);
      const currentReaderId1 = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId1).toStrictEqual(initialWriterId);

      await ProxyHelper.enableAllConnectivity();
      await client.setReadOnly(true);
      const currentReaderId2 = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId2).not.toBe(initialWriterId);
    },
    1320000
  );

  itIf(
    "test failover to new writer set read only true false",
    async () => {
      // Connect to writer instance
      const writerConfig = await initConfigWithFailover(
        env.proxyDatabaseInfo.writerInstanceEndpoint,
        env.proxyDatabaseInfo.instanceEndpointPort,
        true
      );
      client = initClientFunc(writerConfig);
      client.on("error", (error: any) => {
        logger.debug(`event emitter threw error: ${error.message}`);
        logger.debug(error.stack);
      });
      await client.connect();

      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      // Kill all reader instances
      for (const host of env.proxyDatabaseInfo.instances) {
        if (host.instanceId && host.instanceId !== initialWriterId) {
          await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
        }
      }

      // Force internal reader connection to the writer instance
      await client.setReadOnly(true);
      const currentId0 = await auroraTestUtility.queryInstanceId(client);

      expect(currentId0).toStrictEqual(initialWriterId);

      await client.setReadOnly(false);

      await ProxyHelper.enableAllConnectivity();

      // Crash instance 1 and nominate a new writer
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();
      await TestEnvironment.verifyClusterStatus();

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);
      const newWriterId = await auroraTestUtility.queryInstanceId(client);

      expect(await auroraTestUtility.isDbInstanceWriter(newWriterId)).toStrictEqual(true);
      expect(newWriterId).not.toBe(initialWriterId);

      await client.setReadOnly(true);
      const currentReaderId = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId).not.toBe(newWriterId);

      await client.setReadOnly(false);
      const currentId = await auroraTestUtility.queryInstanceId(client);
      expect(currentId).toStrictEqual(newWriterId);
    },
    1320000
  );

  itIf(
    "test failover to new reader set read only false true",
    async () => {
      // Connect to writer instance
      const writerConfig = await initConfigWithFailover(
        env.proxyDatabaseInfo.writerInstanceEndpoint,
        env.proxyDatabaseInfo.instanceEndpointPort,
        true
      );
      writerConfig["failoverMode"] = "reader-or-writer";
      client = initClientFunc(writerConfig);
      client.on("error", (error: any) => {
        logger.debug(`event emitter threw error: ${error.message}`);
        logger.debug(error.stack);
      });

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      await client.setReadOnly(true);

      const readerConnectionId = await auroraTestUtility.queryInstanceId(client);
      expect(readerConnectionId).not.toBe(initialWriterId);
      // Get a reader instance
      let otherReaderId;
      for (const host of env.proxyDatabaseInfo.instances) {
        if (host.instanceId && host.instanceId !== readerConnectionId && host.instanceId !== initialWriterId) {
          otherReaderId = host.instanceId;
          break;
        }
      }

      if (!otherReaderId) {
        throw new Error("Could not find a reader instance");
      }
      // Kill all instances except one other reader
      for (const host of env.proxyDatabaseInfo.instances) {
        if (host.instanceId && host.instanceId !== otherReaderId) {
          await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
        }
      }
      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      const currentReaderId0 = await auroraTestUtility.queryInstanceId(client);

      expect(currentReaderId0).toStrictEqual(otherReaderId);
      expect(currentReaderId0).not.toBe(readerConnectionId);

      await ProxyHelper.enableAllConnectivity();
      await client.setReadOnly(false);

      const currentId = await auroraTestUtility.queryInstanceId(client);
      expect(currentId).toStrictEqual(initialWriterId);

      await client.setReadOnly(true);

      // TODO uncomment after internal pool implementation
      // const currentReaderId2 = await auroraTestUtility.queryInstanceId(client);
      // expect(currentReaderId2).toStrictEqual(otherReaderId);
    },
    1320000
  );

  itIf(
    "test failover reader to writer set read only true false",
    async () => {
      // Connect to writer instance
      const writerConfig = await initConfigWithFailover(
        env.proxyDatabaseInfo.writerInstanceEndpoint,
        env.proxyDatabaseInfo.instanceEndpointPort,
        true
      );
      client = initClientFunc(writerConfig);
      client.on("error", (error: any) => {
        logger.debug(`event emitter threw error: ${error.message}`);
        logger.debug(error.stack);
      });
      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);
      await client.setReadOnly(true);

      const currentReaderId = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId).not.toBe(initialWriterId);

      // Kill all reader instances
      for (const host of env.proxyDatabaseInfo.instances) {
        if (host.instanceId && host.instanceId !== initialWriterId) {
          await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
        }
      }

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      const currentId0 = await auroraTestUtility.queryInstanceId(client);

      expect(currentId0).toStrictEqual(initialWriterId);

      await ProxyHelper.enableAllConnectivity();
      await client.setReadOnly(true);

      const currentId1 = await auroraTestUtility.queryInstanceId(client);
      expect(currentId1).not.toBe(initialWriterId);

      await client.setReadOnly(false);

      const currentId2 = await auroraTestUtility.queryInstanceId(client);
      expect(currentId2).toStrictEqual(initialWriterId);
    },
    1320000
  );
});
