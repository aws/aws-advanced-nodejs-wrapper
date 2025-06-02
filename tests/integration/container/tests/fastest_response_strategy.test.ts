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
import { FailoverSuccessError } from "../../../../common/lib/utils/errors";
import { ProxyHelper } from "./utils/proxy_helper";
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features, instanceCount } from "./config";
import { InternalPooledConnectionProvider } from "../../../../common/lib/internal_pooled_connection_provider";
import { PluginManager } from "../../../../common/lib";
import { RdsHostListProvider } from "../../../../common/lib/host_list_provider/rds_host_list_provider";
import { PluginService } from "../../../../common/lib/plugin_service";

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
let secondaryClient: any;
let auroraTestUtility: AuroraTestUtility;
let provider: InternalPooledConnectionProvider | null;

async function initConfig(host: string, port: number, connectToProxy: boolean, plugins: string): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    plugins: plugins,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP",
    readerHostSelectorStrategy: "fastestResponse"
  };

  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  return await initConfig(host, port, connectToProxy, "readWriteSplitting,fastestResponseStrategy");
}

async function initConfigWithFailover(host: string, port: number, connectToProxy: boolean): Promise<any> {
  const config: any = await initConfig(host, port, connectToProxy, "readWriteSplitting,failover,fastestResponseStrategy");
  config["failoverTimeoutMs"] = 400000;
  return config;
}

describe("aurora fastest response strategy", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    auroraTestUtility = new AuroraTestUtility(env.region);

    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    client = null;
    secondaryClient = null;
    provider = null;
    await TestEnvironment.verifyClusterStatus();
    await TestEnvironment.verifyAllInstancesHasRightState("available");
    await TestEnvironment.verifyAllInstancesUp();

    RdsHostListProvider.clearAll();
    PluginService.clearHostAvailabilityCache();
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

  itIfMinThreeInstance(
    "test failover to new reader use cached connection",
    async () => {
      // Connect to writer instance
      const writerConfig = await initConfigWithFailover(
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
      // Connect using cached fastest connection.
      await client.setReadOnly(true);

      const currentReaderId2 = await auroraTestUtility.queryInstanceId(client);
      expect(currentReaderId2).toStrictEqual(otherReaderId);
    },
    1320000
  );

  itIf(
    "test secondary client use fastest connection",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort, false);

      client = initClientFunc(config);
      secondaryClient = initClientFunc(config);

      await client.connect();
      await client.setReadOnly(true);
      const currentReaderId0 = await auroraTestUtility.queryInstanceId(client);
      await client.end();
      await secondaryClient.connect();

      // Connect using cached fastest connection.
      await secondaryClient.setReadOnly(true);
      const currentReaderId1 = await auroraTestUtility.queryInstanceId(secondaryClient);

      expect(currentReaderId1).toStrictEqual(currentReaderId0);
      expect(client).not.toBe(secondaryClient);
    },
    1000000
  );
});
