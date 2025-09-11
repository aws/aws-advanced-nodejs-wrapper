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
import { ProxyHelper } from "./utils/proxy_helper";
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features, instanceCount } from "./config";
import { AwsWrapperError, PluginManager } from "../../../../index";
import { RdsHostListProvider } from "../../../../common/lib/host_list_provider/rds_host_list_provider";
import { PluginServiceImpl } from "../../../../common/lib/plugin_service";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  features.includes(TestEnvironmentFeatures.IAM) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 2
    ? it
    : it.skip;
const itIfMinThreeInstance = instanceCount >= 3 ? itIf : it.skip;

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;
let client: any;
let auroraTestUtility: AuroraTestUtility;
let numReaders: number;

async function initConfig(readerHostSelectorStrategy: string): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: env.databaseInfo.clusterReadOnlyEndpoint,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: env.databaseInfo.clusterEndpointPort,
    plugins: "initialConnection",
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP",
    readerHostSelectorStrategy: readerHostSelectorStrategy
  };

  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

describe("aurora initial connection strategy", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    auroraTestUtility = new AuroraTestUtility(env.region);

    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    client = null;
    await TestEnvironment.verifyClusterStatus();
    await TestEnvironment.verifyAllInstancesHasRightState("available");
    await TestEnvironment.verifyAllInstancesUp();

    RdsHostListProvider.clearAll();
    PluginServiceImpl.clearHostAvailabilityCache();
    numReaders = env.databaseInfo.instances.length - 1;
  }, 1320000);

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
  }, 1320000);

  itIf(
    "test round robin",
    async () => {
      const config = await initConfig("roundRobin");
      // default weight
      config["roundRobinHostWeightPairs"] = null;
      const connectedReaderIds: Set<string> = new Set();
      const connectionsSet: Set<any> = new Set();
      try {
        // first instance is not cached
        client = initClientFunc(config);
        await client.connect();
        const readerId = await auroraTestUtility.queryInstanceId(client);
        connectionsSet.add(readerId);

        for (let i = 0; i < numReaders; i++) {
          const client = initClientFunc(config);
          await client.connect();

          const readerId = await auroraTestUtility.queryInstanceId(client);
          expect(connectedReaderIds).not.toContain(readerId);
          connectedReaderIds.add(readerId);
          connectionsSet.add(client);
        }
      } finally {
        for (const connection of connectionsSet) {
          try {
            await connection.end();
          } catch (error) {
            // pass
          }
        }
      }
    },
    1000000
  );

  itIfMinThreeInstance(
    "test round robin host weight pairs",
    async () => {
      const connectedReaderIds: Set<string> = new Set();
      const connectionsSet: Set<any> = new Set();
      const initialReader = env.databaseInfo.readerInstanceId;
      const config = await initConfig("roundRobin");
      config["roundRobinHostWeightPairs"] = `${initialReader}:${numReaders}`;

      // first instance is not cached
      client = initClientFunc(config);
      await client.connect();
      const readerId = await auroraTestUtility.queryInstanceId(client);
      connectionsSet.add(readerId);

      try {
        for (let i = 0; i < numReaders; i++) {
          const client = initClientFunc(config);
          await client.connect();

          const readerId = await auroraTestUtility.queryInstanceId(client);
          // All connections should be made to the initial reader with high weight instance.
          connectedReaderIds.add(readerId);
          connectionsSet.add(client);
          expect(connectedReaderIds).toContain(readerId);
          expect(connectedReaderIds.size).toBe(1);
        }
        for (let i = 0; i < numReaders - 1; i++) {
          const client = initClientFunc(config);
          // All remaining connections should be evenly distributed amongst the other reader instances.
          await client.connect();

          const readerId = await auroraTestUtility.queryInstanceId(client);
          expect(connectedReaderIds).not.toContain(readerId);
          connectionsSet.add(client);
        }
      } finally {
        for (const connection of connectionsSet) {
          try {
            await connection.end();
          } catch (error) {
            // pass
          }
        }
      }
    },
    1000000
  );

  itIf(
    "test random initial connection strategy",
    async () => {
      const config = await initConfig("random");
      client = initClientFunc(config);
      await client.connect();
      await auroraTestUtility.queryInstanceId(client);
    },
    1000000
  );

  itIf(
    "test invalid initial connection strategy",
    async () => {
      const config = await initConfig("leastConnections");
      // default weight
      config["roundRobinHostWeightPairs"] = null;

      client = initClientFunc(config);
      await expect(async () => {
        await client.connect();
      }).rejects.toThrow(AwsWrapperError);
    },
    1000000
  );
});
