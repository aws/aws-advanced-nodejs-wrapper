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
import { ConnectTimePlugin, ExecuteTimePlugin, PluginManager } from "../../../../index";
import { RdsHostListProvider } from "../../../../common/lib/host_list_provider/rds_host_list_provider";
import { PluginServiceImpl } from "../../../../common/lib/plugin_service";
import { getTimeInNanos } from "../../../../common/lib/utils/utils";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  features.includes(TestEnvironmentFeatures.IAM) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 2
    ? it
    : it.skip;

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;
let client: any;
let auroraTestUtility: AuroraTestUtility;

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
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

describe("aurora connect and execute time plugin", () => {
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
    "test connect time",
    async () => {
      const writerConfig = await initConfig(
        env.proxyDatabaseInfo.writerInstanceEndpoint,
        env.proxyDatabaseInfo.instanceEndpointPort,
        true,
        "connectTime"
      );
      client = initClientFunc(writerConfig);
      const startTime = Number(getTimeInNanos());
      expect(Number(ConnectTimePlugin.getTotalConnectTime())).toBe(0);
      await client.connect();
      const connectTime = ConnectTimePlugin.getTotalConnectTime();
      const elapsedTime = Number(getTimeInNanos()) - startTime;
      expect(Number(connectTime)).toBeGreaterThan(0);
      expect(elapsedTime).toBeGreaterThan(connectTime);
    },
    1320000
  );

  itIf(
    "test execute time",
    async () => {
      const writerConfig = await initConfig(
        env.proxyDatabaseInfo.writerInstanceEndpoint,
        env.proxyDatabaseInfo.instanceEndpointPort,
        true,
        "executeTime"
      );
      client = initClientFunc(writerConfig);
      await client.connect();
      const startTime = Number(getTimeInNanos());
      const executePluginStartTime = Number(ExecuteTimePlugin.getTotalExecuteTime());
      await auroraTestUtility.queryInstanceId(client);
      const elapsedTime = Number(getTimeInNanos()) - startTime;
      const executeTime = Number(ExecuteTimePlugin.getTotalExecuteTime()) - executePluginStartTime;
      expect(executeTime).toBeGreaterThan(executePluginStartTime);
      expect(elapsedTime).toBeGreaterThan(executeTime);
    },
    1320000
  );
});
