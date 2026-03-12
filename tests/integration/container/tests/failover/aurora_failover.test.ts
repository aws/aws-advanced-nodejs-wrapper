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

import { TestEnvironment } from "../utils/test_environment";
import { DriverHelper } from "../utils/driver_helper";
import { AuroraTestUtility } from "../utils/aurora_test_utility";
import { FailoverSuccessError, PluginManager } from "../../../../../index";
import { ProxyHelper } from "../utils/proxy_helper";
import { logger } from "../../../../../common/logutils";
import { features, instanceCount } from "../config";
import { TestEnvironmentFeatures } from "../utils/test_environment_features";
import { createFailoverTests } from "./failover_tests";

const itIfThreeInstanceAuroraCluster = instanceCount == 3 && !features.includes(TestEnvironmentFeatures.RDS_MULTI_AZ_SUPPORTED) ? it : it.skip;

describe("aurora failover", createFailoverTests({ plugins: "failover" }));

describe("aurora failover - efm specific", () => {
  let env: TestEnvironment;
  let client: any;
  let initClientFunc: (props: any) => any;
  let auroraTestUtility: AuroraTestUtility;

  async function initConfigWithEFM2(host: string, port: number, connectToProxy: boolean): Promise<any> {
    let config: any = {
      user: env.databaseInfo.username,
      host: host,
      database: env.databaseInfo.defaultDbName,
      password: env.databaseInfo.password,
      port: port,
      plugins: "failover,efm2",
      failoverTimeoutMs: 20000,
      failureDetectionCount: 2,
      failureDetectionInterval: 1000,
      failureDetectionTime: 2000,
      connectTimeout: 10000,
      wrapperQueryTimeout: 20000,
      monitoring_wrapperQueryTimeout: 3000,
      monitoring_wrapperConnectTimeout: 3000,
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

  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    auroraTestUtility = new AuroraTestUtility(env.region);
    const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    await TestEnvironment.verifyClusterStatus();
    client = null;
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

  itIfThreeInstanceAuroraCluster(
    "writer failover efm",
    async () => {
      // Connect to writer instance
      const writerConfig = await initConfigWithEFM2(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.instanceEndpointPort, true);
      writerConfig["failoverMode"] = "reader-or-writer";

      client = initClientFunc(writerConfig);
      await client.connect();

      const initialWriterId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toStrictEqual(true);
      const instances = env.databaseInfo.instances;
      const readerInstance = instances[1].instanceId;
      await ProxyHelper.disableAllConnectivity(env.engine);

      try {
        await ProxyHelper.enableConnectivity(initialWriterId);

        // Sleep query activates monitoring connection after monitoring_wrapperQueryTimeout time is reached
        await auroraTestUtility.queryInstanceIdWithSleep(client);

        await ProxyHelper.enableConnectivity(readerInstance);
        await ProxyHelper.disableConnectivity(env.engine, initialWriterId);
      } catch (error) {
        fail("The disable connectivity task was unexpectedly interrupted.");
      }
      // Failure occurs on connection invocation
      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow(FailoverSuccessError);

      const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
      expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(false);
      expect(currentConnectionId).not.toBe(initialWriterId);
    },
    1320000
  );
});
