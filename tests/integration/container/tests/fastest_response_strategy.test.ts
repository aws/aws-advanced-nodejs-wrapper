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
import { RdsUtils } from "../../../../common/lib/utils/rds_utils";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  features.includes(TestEnvironmentFeatures.IAM) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 2
    ? it
    : it.skip;
const itIfMinFiveInstance = instanceCount >= 5 ? itIf : it.skip;

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
    telemetryMetricsBackend: "OTLP"
  };

  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  const config: any = await initConfig(host, port, connectToProxy, "readWriteSplitting,failover,fastestResponseStrategy");
  config["readerHostSelectorStrategy"] = "fastestResponse";
  config["failoverTimeoutMs"] = 400000;
  return config;
}

async function initConfigSmallResponseTime(host: string, port: number, connectToProxy: boolean): Promise<any> {
  const config: any = await initConfig(host, port, connectToProxy, "readWriteSplitting,failover,fastestResponseStrategy");
  config["readerHostSelectorStrategy"] = "fastestResponse";
  config["responseMeasurementIntervalMs"] = 2000;
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
    await PluginManager.releaseResources();
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
    "test failover to new writer set read only true false",
    async () => {
      // Connect to writer instance
      const writerConfig = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);
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

  itIfMinFiveInstance(
    "test switch to disabled reader failover",
    async () => {
      // Connect to writer instance
      const writerConfig = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);
      client = initClientFunc(writerConfig);
      await client.connect();

      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      // switch to reader
      await client.setReadOnly(true);
      const initialReaderId = await auroraTestUtility.queryInstanceId(client);

      expect(initialReaderId).not.toStrictEqual(initialWriterId);

      // switch to writer
      await client.setReadOnly(false);

      // disable reader
      await ProxyHelper.disableConnectivity(env.engine, initialReaderId);

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      await ProxyHelper.enableAllConnectivity();

      // switch to reader
      await client.setReadOnly(true);

      const currentId = await auroraTestUtility.queryInstanceId(client);
      expect(currentId).toStrictEqual(initialReaderId);
    },
    1320000
  );

  itIfMinFiveInstance(
    "test secondary reader",
    async () => {
      // Connect to writer instance
      const writerConfig = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);
      client = initClientFunc(writerConfig);
      await client.connect();

      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);

      // switch to reader
      await client.setReadOnly(true);
      const initialReaderId = await auroraTestUtility.queryInstanceId(client);

      expect(initialReaderId).not.toStrictEqual(initialWriterId);

      // switch to writer
      await client.setReadOnly(false);

      // disable reader
      await ProxyHelper.disableConnectivity(env.engine, initialReaderId);

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      await ProxyHelper.enableAllConnectivity();

      // switch to reader
      await client.setReadOnly(true);

      const currentId = await auroraTestUtility.queryInstanceId(client);
      expect(currentId).toStrictEqual(initialReaderId);
    },
    1320000
  );
});
