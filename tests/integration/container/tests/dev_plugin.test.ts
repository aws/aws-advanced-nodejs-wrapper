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
import { features, instanceCount } from "./config";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { PluginManager } from "../../../../common/lib";
import { ErrorSimulatorManager } from "../../../../common/lib/plugins/dev/error_simulator_manager";
import { DeveloperConnectionPlugin } from "../../../../common/lib/plugins/dev/developer_connection_plugin";
import { ErrorSimulatorMethodCallback } from "../../../../common/lib/plugins/dev/error_simulator_method_callback";
import { ErrorSimulator } from "../../../../common/lib/plugins/dev/error_simulator";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 2
    ? it
    : it.skip;

let env: TestEnvironment;
let driver;
let client: any;
let initClientFunc: (props: any) => any;
let auroraTestUtility: AuroraTestUtility;

async function initDefaultConfig(host: string, port: number): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    plugins: "dev"
  };
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

class TestErrorCallback implements ErrorSimulatorMethodCallback {
  getErrorToRaise<T>(methodName: string, methodArgs: any): Error | null {
    if (methodName == "query" && methodArgs == "select 1") {
      return new Error("test_query");
    }
    return null;
  }
}

describe("aurora developer plugin", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();

    auroraTestUtility = new AuroraTestUtility(env.region);
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
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

  itIf(
    "error on next connect",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort);
      client = initClientFunc(config);

      const testErrorToRaise: Error = new Error("test_connect");
      ErrorSimulatorManager.raiseErrorOnNextConnect(testErrorToRaise);

      await expect(async () => {
        await client.connect();
      }).rejects.toThrow(Error("test_connect"));

      // Connects with no error.
      await client.connect();
    },
    1320000
  );

  itIf(
    "error on next query on opened connection",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort);
      client = initClientFunc(config);

      const simulator: ErrorSimulator = client.getPluginInstance(DeveloperConnectionPlugin);
      const testErrorToRaise: Error = new Error("test_query");
      simulator.raiseErrorOnNextCall(testErrorToRaise, "query");

      // No error thrown on connect call.
      await client.connect();

      await expect(async () => {
        await client.query("select 1");
      }).rejects.toThrow(Error("test_query"));

      // No error thrown on next query.
      await client.query("select 1");
    },
    1320000
  );

  itIf(
    "error on query callback",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.instanceEndpointPort);
      client = initClientFunc(config);
      const simulator: ErrorSimulator = client.getPluginInstance(DeveloperConnectionPlugin);
      simulator.setCallback(new TestErrorCallback());

      // No error thrown on connect call.
      await client.connect();

      // Executes normally.
      await client.query("select 2");

      await expect(async () => {
        await client.query("select 1");
      }).rejects.toThrow(Error("test_query"));
    },
    1320000
  );
});
