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
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features, instanceCount } from "./config";
import { InternalPooledConnectionProvider } from "../../../../common/lib/internal_pooled_connection_provider";
import { AwsPoolConfig } from "../../../../common/lib/aws_pool_config";
import { ConnectionProviderManager } from "../../../../common/lib/connection_provider_manager";
import { TestInstanceInfo } from "./utils/test_instance_info";
import { sleep } from "../../../../common/lib/utils/utils";
import { FailoverSuccessError } from "../../../../common/lib/utils/errors";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 2
    ? it
    : it.skip;
const itIfMinFiveInstance = instanceCount >= 5 ? itIf : it.skip;

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;
let connectionsSet: Set<any> = new Set();
let newInstance: TestInstanceInfo;
let newInstanceClient: any;
let auroraTestUtility: AuroraTestUtility;
let provider: InternalPooledConnectionProvider | null;
const instanceId: string = "auto-scaling-instance";

async function initDefaultConfig(host: string, port: number, provider: InternalPooledConnectionProvider): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "readWriteSplitting",
    connectionProvider: provider,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP",
    readerHostSelectorStrategy: "leastConnections",
    clusterTopologyRefreshRateMs: 5000
  };

  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function initConfigWithFailover(host: string, port: number, provider: InternalPooledConnectionProvider): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "readWriteSplitting,failover",
    connectionProvider: provider,
    failoverTimeoutMs: 400000,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP",
    readerHostSelectorStrategy: "leastConnections",
    clusterTopologyRefreshRateMs: 5000
  };

  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

describe("pooled connection autoscaling", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    auroraTestUtility = new AuroraTestUtility(env.region);

    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);

    connectionsSet = new Set();
    provider = null;
    await auroraTestUtility.deleteInstance(instanceId);
    await TestEnvironment.verifyClusterStatus();
  }, 1320000);

  afterEach(async () => {
    if (provider !== null) {
      try {
        await provider.releaseResources();
      } catch (error) {
        // pass
      }
    }
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  itIfMinFiveInstance(
    "set read only on old connection",
    async () => {
      // Test setup.
      const totalInstances: number = await auroraTestUtility.getNumberOfInstances();
      const instances: TestInstanceInfo[] = env.databaseInfo.instances;
      const numInstances: number = instances.length;
      const idleTimeoutMillis = 10 * 60 * 1000; // 10 minutes
      const poolExpirationNanos = BigInt(3 * 60 * 1000_000_000); // 3 minutes
      const poolCleanupNanos = BigInt(10 * 60 * 1000_000_000); // 10 minutes

      // Set provider.
      provider = new InternalPooledConnectionProvider(
        new AwsPoolConfig({
          maxConnections: numInstances,
          idleTimeoutMillis: idleTimeoutMillis
        }),
        undefined,
        poolExpirationNanos,
        poolCleanupNanos
      );

      // Initialize clients.
      try {
        for (let i = 1; i < numInstances; i++) {
          const host = instances[i].host;
          const port = instances[i].port;
          if (host && port) {
            const config: any = await initDefaultConfig(host, port, provider);
            const client = initClientFunc(config);
            await client.connect();
            connectionsSet.add(client);
          }
        }

        // Create new instance.
        newInstance = await auroraTestUtility.createInstance(instanceId);
        if (!newInstance?.instanceId || !newInstance?.host || !newInstance?.port) {
          fail("Instance not returned.");
        }

        // Connect to instance.
        try {
          const config = await initConfigWithFailover(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, provider);
          newInstanceClient = initClientFunc(config);
          await newInstanceClient.connect();
          connectionsSet.add(newInstanceClient);
          const writerInstance = await auroraTestUtility.queryInstanceId(newInstanceClient);

          // Should connect to created instance.
          await newInstanceClient.setReadOnly(true);
          expect(await provider.containsHost(newInstance.host)).toBe(true);
          expect(await auroraTestUtility.queryInstanceId(newInstanceClient)).toBe(newInstance.instanceId);

          await newInstanceClient.setReadOnly(false);
          expect(await auroraTestUtility.queryInstanceId(newInstanceClient)).toBe(writerInstance);
        } finally {
          const instance = newInstance.instanceId ? newInstance.instanceId : instanceId;
          let deleted = false;
          setTimeout(async () => {
            const stopTime = Date.now() + 5 * 60 * 1000;
            while (!deleted && Date.now() < stopTime) {
              await auroraTestUtility.queryInstanceId(newInstanceClient);
              await sleep(3000);
            }
          }, 3000);
          await auroraTestUtility.deleteInstance(instance);
          deleted = true;
        }

        // Should have removed the pool with the deleted instance.
        await newInstanceClient.setReadOnly(true);

        const readerId = await auroraTestUtility.queryInstanceId(newInstanceClient);
        expect(newInstance.instanceId).not.toBe(readerId);
        expect(await provider.containsHost(newInstance.host)).toBe(false);
        expect(provider.getHostCount()).toBeLessThanOrEqual(instances.length);
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
    1320000
  );

  itIfMinFiveInstance(
    "failover from deleted reader",
    async () => {
      // Test setup.
      const instances: TestInstanceInfo[] = env.databaseInfo.instances;
      const numInstances: number = instances.length;

      // Set provider.
      provider = new InternalPooledConnectionProvider(new AwsPoolConfig({ maxConnections: numInstances * 5 }));

      // Initialize clients.
      try {
        for (let i = 1; i < numInstances; i++) {
          const host = instances[i].host;
          const port = instances[i].port;
          if (host && port) {
            const config: any = await initConfigWithFailover(host, port, provider);
            const client = initClientFunc(config);
            const newClient = initClientFunc(config);
            await newClient.connect();
            connectionsSet.add(newClient);

            await client.connect();
            connectionsSet.add(client);
          }
        }

        // Create new instance.
        newInstance = await auroraTestUtility.createInstance(instanceId);
        if (!newInstance?.instanceId || !newInstance?.host || !newInstance?.port) {
          fail("Instance not returned.");
        }

        // Connect to instance.
        try {
          const config = await initConfigWithFailover(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, provider);
          newInstanceClient = initClientFunc(config);
          await newInstanceClient.connect();
          connectionsSet.add(newInstanceClient);

          // Should connect to created instance.
          await newInstanceClient.setReadOnly(true);
          expect(await provider.containsHost(newInstance.host)).toBe(true);
          expect(await auroraTestUtility.queryInstanceId(newInstanceClient)).toBe(newInstance.instanceId);
        } finally {
          await auroraTestUtility.deleteInstance(newInstance.instanceId ? newInstance.instanceId : instanceId);
        }

        await expect(auroraTestUtility.queryInstanceId(newInstanceClient)).rejects.toThrow(FailoverSuccessError);

        const readerId: string = await auroraTestUtility.queryInstanceId(newInstanceClient);
        expect(newInstance.instanceId).not.toBe(readerId);
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
    1320000
  );
});
