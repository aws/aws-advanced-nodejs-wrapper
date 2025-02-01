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
import { ProxyHelper } from "./utils/proxy_helper";
import { logger } from "../../../../common/logutils";
import { features, instanceCount } from "./config";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { PluginManager } from "../../../../common/lib";
import { DatabaseEngine } from "./utils/database_engine";
import { TransactionIsolationLevel } from "../../../../common/lib/utils/transaction_isolation_level";
import { RdsUtils } from "../../../../common/lib/utils/rds_utils";
import { QueryResult } from "pg";

const itIf =
  features.includes(TestEnvironmentFeatures.FAILOVER_SUPPORTED) &&
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 2
    ? it
    : it.skip;
const itIfTwoInstance = instanceCount == 2 ? itIf : it.skip;
const itIfMinThreeInstance = instanceCount >= 3 ? itIf : it.skip;

let env: TestEnvironment;
let driver;
let client: any;
let secondaryClient: any;
let initClientFunc: (props: any) => any;

let auroraTestUtility: AuroraTestUtility;

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    plugins: "failover2",
    failoverTimeoutMs: 250000,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP"
  };
  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function initConfigWithRWSplitting(host: string, port: number, connectToProxy: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    plugins: "readWriteSplitting,failover2",
    failoverTimeoutMs: 400000,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP"
  };

  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

describe("aurora failover2", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();

    auroraTestUtility = new AuroraTestUtility(env.region);
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    await TestEnvironment.verifyClusterStatus();
    await TestEnvironment.verifyAllInstancesHasRightState("available");
    await TestEnvironment.verifyAllInstancesUp();

    client = null;
    secondaryClient = null;
  }, 1320000);

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
    await PluginManager.releaseResources();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  itIf(
    "fails from writer to new writer on connection invocation",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      await client.connect();

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
    },
    1320000
  );

  itIf(
    "writer fails within transaction",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      await DriverHelper.executeQuery(env.engine, client, "DROP TABLE IF EXISTS test3_3");
      await DriverHelper.executeQuery(env.engine, client, "CREATE TABLE test3_3 (id int not null primary key, test3_3_field varchar(255) not null)");

      await DriverHelper.executeQuery(env.engine, client, "START TRANSACTION"); // start transaction
      await DriverHelper.executeQuery(env.engine, client, "INSERT INTO test3_3 VALUES (1, 'test field string 1')");

      // Crash instance 1 and nominate a new writer.
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

      await expect(async () => {
        await DriverHelper.executeQuery(env.engine, client, "INSERT INTO test3_3 VALUES (2, 'test field string 2')");
      }).rejects.toThrow(TransactionResolutionUnknownError);

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
    2000000
  );

  itIf(
    "fails from writer and transfers session state",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toBe(true);

      await client.setReadOnly(true);
      await client.setTransactionIsolation(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);

      if (driver === DatabaseEngine.PG) {
        await client.setSchema(env.databaseInfo.defaultDbName);
      } else if (driver === DatabaseEngine.MYSQL) {
        await client.setAutoCommit(false);
        await client.setCatalog(env.databaseInfo.defaultDbName);
      }

      // Failover cluster and nominate a new writer.
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      // Assert that we are connected to the new writer after failover happens.
      const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
      expect(currentConnectionId).not.toBe(initialWriterId);
      expect(client.isReadOnly()).toBe(true);
      expect(client.getTransactionIsolation()).toBe(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);
      if (driver === DatabaseEngine.PG) {
        expect(client.getSchema()).toBe(env.databaseInfo.defaultDbName);
      } else if (driver === DatabaseEngine.MYSQL) {
        expect(client.getAutoCommit()).toBe(false);
        expect(client.getCatalog()).toBe(env.databaseInfo.defaultDbName);
      }
    },
    1320000
  );

  itIfTwoInstance(
    "fails from reader to writer",
    async () => {
      // Connect to writer instance.
      const writerConfig = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);
      client = initClientFunc(writerConfig);
      await client.connect();
      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      // Get a reader instance.
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
      await secondaryClient.connect();

      // Crash the reader instance.
      const rdsUtils = new RdsUtils();
      const readerInstanceId = rdsUtils.getRdsInstanceId(readerInstanceHost);
      if (readerInstanceId) {
        await ProxyHelper.disableConnectivity(env.engine, readerInstanceId);

        await expect(async () => {
          await auroraTestUtility.queryInstanceId(secondaryClient);
        }).rejects.toThrow(FailoverSuccessError);

        await ProxyHelper.enableConnectivity(readerInstanceId);

        // Assert that we are currently connected to the writer instance.
        const currentConnectionId = await auroraTestUtility.queryInstanceId(secondaryClient);
        expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(true);
        expect(currentConnectionId).toBe(initialWriterId);
      }
    },
    1320000
  );

  itIfMinThreeInstance(
    "test failover to new writer set read only true false",
    async () => {
      // Connect to writer instance
      const writerConfig = await initConfigWithRWSplitting(
        env.proxyDatabaseInfo.writerInstanceEndpoint,
        env.proxyDatabaseInfo.instanceEndpointPort,
        true
      );
      client = initClientFunc(writerConfig);
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

  itIfMinThreeInstance(
    "test failover to new reader set read only false true",
    async () => {
      // Connect to writer instance
      const writerConfig = await initConfigWithRWSplitting(
        env.proxyDatabaseInfo.writerInstanceEndpoint,
        env.proxyDatabaseInfo.instanceEndpointPort,
        true
      );
      writerConfig["failoverMode"] = "reader-or-writer";
      client = initClientFunc(writerConfig);

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

      const currentReaderId2 = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId2).toStrictEqual(otherReaderId);
    },
    1320000
  );
});
