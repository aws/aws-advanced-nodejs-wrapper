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
import { FailoverSuccessError, TransactionResolutionUnknownError } from "aws-wrapper-common-lib/lib/utils/errors";
import { DatabaseEngine } from "./utils/database_engine";
import { QueryResult } from "pg";
import { ProxyHelper } from "./utils/proxy_helper";
import { RdsUtils } from "aws-wrapper-common-lib/lib/utils/rds_utils";
import { logger } from "aws-wrapper-common-lib/logutils";

let env: TestEnvironment;
let driver;
let client: any;
let initClientFunc: (props: any) => any;

const auroraTestUtility = new AuroraTestUtility();

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  const env = await TestEnvironment.getCurrent();

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
  beforeAll(async () => {
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
  });

  beforeEach(async () => {
    await ProxyHelper.enableAllConnectivity();
    client = null;
  });

  afterEach(async () => {
    if (client !== null) {
      await client.end();
    }
  });

  it("fail from writer to new writer on connection invocation", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    client = initClientFunc(config);
    client.on("error", (error: any) => {
      logger.debug(error);
    });

    await client.connect();

    const initialWriterId = await auroraTestUtility.queryInstanceId(client);

    // Crash instance 1 and nominate a new writer
    await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

    await expect(async () => {
      await DriverHelper.executeQuery(env.engine, client, DriverHelper.getSleepQuery(env.engine, 15));
    }).rejects.toThrow(FailoverSuccessError);

    // Assert that we are connected to the new writer after failover happens
    const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
    expect(currentConnectionId).not.toBe(initialWriterId);
  }, 1000000);

  it("fail from reader to writer", async () => {
    // Connect to writer instance
    const writerConfig = await initDefaultConfig(env.proxyDatabaseInfo.clusterEndpoint, env.proxyDatabaseInfo.clusterEndpointPort, true);
    client = initClientFunc(writerConfig);
    client.on("error", (err: any) => {
      logger.debug(err);
    });
    await client.connect();
    const writerId = await auroraTestUtility.queryInstanceId(client);

    // Get a reader instance
    let readerInstanceHost;
    for (const host of env.proxyDatabaseInfo.instances) {
      if (host.instanceId && host.instanceId !== writerId) {
        readerInstanceHost = host.host;
      }
    }
    if (!readerInstanceHost) {
      throw new Error("Could not find a reader instance");
    }

    const readerConfig = await initDefaultConfig(readerInstanceHost, env.proxyDatabaseInfo.clusterEndpointPort, true);

    const readerClient = initClientFunc(readerConfig);
    readerClient.on("error", (err: any) => {
      logger.debug(err);
    });
    try {
      await readerClient.connect();

      // Crash the reader instance
      const rdsUtils = new RdsUtils();
      const readerInstanceId = rdsUtils.getRdsInstanceId(readerInstanceHost);
      if (readerInstanceId) {
        await ProxyHelper.disableConnectivity(env.engine, readerInstanceId);

        await expect(async () => {
          await DriverHelper.executeQuery(env.engine, client, DriverHelper.getSleepQuery(env.engine, 15));
        }).rejects.toThrow(FailoverSuccessError);

        await ProxyHelper.enableConnectivity(readerInstanceId);

        // Assert that we are currently connected to the writer instance
        const currentConnectionId = await auroraTestUtility.queryInstanceId(readerClient);
        expect(currentConnectionId).toBe(writerId);
        expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
      }
    } finally {
      await readerClient.end();
    }
  }, 1000000);

  it("writer fail within transaction", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    client = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(error);
    });

    await client.connect();
    const initialWriterId = await auroraTestUtility.queryInstanceId(client);

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
  }, 1000000);

  it("fail from writer and transfer session state", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    client = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(error);
    });

    await client.connect();
    await client.setReadOnly(true);

    const initialWriterId = await auroraTestUtility.queryInstanceId(client);

    // Crash instance 1 and nominate a new writer
    await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

    await expect(async () => {
      await DriverHelper.executeQuery(env.engine, client, DriverHelper.getSleepQuery(env.engine, 15));
    }).rejects.toThrow(FailoverSuccessError);

    expect(client.isReadOnly()).toBe(true);

    // Assert that we are connected to the new writer after failover happens
    const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
    expect(currentConnectionId).not.toBe(initialWriterId);
  }, 1000000);
});
