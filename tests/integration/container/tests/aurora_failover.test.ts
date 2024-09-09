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
import { FailoverSuccessError, TransactionResolutionUnknownError } from "../../../../common/lib/utils/errors";
import { DatabaseEngine } from "./utils/database_engine";
import { QueryResult } from "pg";
import { ProxyHelper } from "./utils/proxy_helper";
import { RdsUtils } from "../../../../common/lib/utils/rds_utils";
import { logger } from "../../../../common/logutils";
import { features } from "./config";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";

const itIf = features.includes(TestEnvironmentFeatures.FAILOVER_SUPPORTED) && !features.includes(TestEnvironmentFeatures.PERFORMANCE) ? it : it.skip;

let env: TestEnvironment;
let driver;
let client: any;
let secondaryClient: any;
let initClientFunc: (props: any) => any;

const auroraTestUtility = new AuroraTestUtility();

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "failover",
    failoverTimeoutMs: 250000
  };
  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

describe("aurora failover", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();

    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    await TestEnvironment.updateWriter();

    client = null;
    secondaryClient = null;
    await TestEnvironment.updateWriter();
  });

  afterEach(async () => {
    if (client !== null) {
      try {
        await client.end();
      } catch (error) {
        // pass
      }
    }

    if (secondaryClient !== null) {
      try {
        await secondaryClient.end();
      } catch (error) {
        // pass
      }
    }
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1000000);

  itIf(
    "fails from writer to new writer on connection invocation",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);
      client.on("error", (error: any) => {
        logger.debug(error.message);
      });

      await client.connect();

      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      // Crash instance 1 and nominate a new writer
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      // Assert that we are connected to the new writer after failover happens
      const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
      expect(currentConnectionId).not.toBe(initialWriterId);
    },
    1000000
  );

  itIf(
    "writer fails within transaction",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      client.on("error", (error: any) => {
        logger.debug(error.message);
      });

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      await DriverHelper.executeQuery(env.engine, client, "DROP TABLE IF EXISTS test3_3");
      await DriverHelper.executeQuery(env.engine, client, "CREATE TABLE test3_3 (id int not null primary key, test3_3_field varchar(255) not null)");

      await DriverHelper.executeQuery(env.engine, client, "START TRANSACTION"); // start transaction
      await DriverHelper.executeQuery(env.engine, client, "INSERT INTO test3_3 VALUES (1, 'test field string 1')");

      // Crash instance 1 and nominate a new writer
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

      await expect(async () => {
        await DriverHelper.executeQuery(env.engine, client, "INSERT INTO test3_3 VALUES (2, 'test field string 2')");
      }).rejects.toThrow(TransactionResolutionUnknownError);

      // Attempt to query the instance id.
      const currentConnectionId = await auroraTestUtility.queryInstanceId(client);

      // Assert that we are connected to the new writer after failover happens.
      expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);

      const nextClusterWriterId = await auroraTestUtility.getClusterWriterInstanceId();
      expect(currentConnectionId).toBe(nextClusterWriterId);
      expect(initialWriterId).not.toBe(nextClusterWriterId);

      // Assert that NO row has been inserted to the table.
      const result = await DriverHelper.executeQuery(env.engine, client, "SELECT count(*) from test3_3");
      if (env.engine === DatabaseEngine.PG) {
        expect((result as QueryResult).rows[0]["count"]).toBe("0");
      } else if (env.engine === DatabaseEngine.MYSQL) {
        expect(JSON.parse(JSON.stringify(result))[0][0]["count(*)"]).toBe(0);
      }

      await DriverHelper.executeQuery(env.engine, client, "DROP TABLE IF EXISTS test3_3");
    },
    1000000
  );

  itIf(
    "fails from writer and transfers session state",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      client.on("error", (error: any) => {
        logger.debug(error.message);
      });

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toBe(true);

      await client.setReadOnly(true);
      const writerId = await auroraTestUtility.queryInstanceId(client);

      // Failover cluster and nominate a new writer
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      // Assert that we are connected to the new writer after failover happens
      const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
      expect(currentConnectionId).not.toBe(initialWriterId);
    },
    1000000
  );

  itIf(
    "fails from reader to writer",
    async () => {
      // Connect to writer instance
      const writerConfig = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);
      client = initClientFunc(writerConfig);
      client.on("error", (err: any) => {
        logger.debug(err);
      });
      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      // Get a reader instance
      let readerInstanceHost;
      for (const host of env.proxyDatabaseInfo.instances) {
        if (host.instanceId && host.instanceId !== initialWriterId) {
          readerInstanceHost = host.host;
        }
      }
      if (!readerInstanceHost) {
        throw new Error("Could not find a reader instance");
      }
      const readerConfig = await initDefaultConfig(readerInstanceHost, env.proxyDatabaseInfo.instanceEndpointPort, true);

      secondaryClient = initClientFunc(readerConfig);
      secondaryClient.on("error", (err: any) => {
        logger.debug(err);
      });

      await secondaryClient.connect();

      // Crash the reader instance
      const rdsUtils = new RdsUtils();
      const readerInstanceId = rdsUtils.getRdsInstanceId(readerInstanceHost);
      if (readerInstanceId) {
        await ProxyHelper.disableConnectivity(env.engine, readerInstanceId);

        await expect(async () => {
          await auroraTestUtility.queryInstanceId(secondaryClient);
        }).rejects.toThrow(FailoverSuccessError);

        await ProxyHelper.enableConnectivity(readerInstanceId);

        // Assert that we are currently connected to the writer instance
        const currentConnectionId = await auroraTestUtility.queryInstanceId(secondaryClient);
        expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
        expect(currentConnectionId).toBe(initialWriterId);
      }
    },
    1000000
  );
});
