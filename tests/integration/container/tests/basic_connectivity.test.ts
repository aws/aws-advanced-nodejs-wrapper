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
import { ProxyHelper } from "./utils/proxy_helper";
import { DriverHelper } from "./utils/driver_helper";
import { AuroraTestUtility } from "./utils/aurora_test_utility";
import { logger } from "../../../../common/logutils";
import { DatabaseEngine } from "./utils/database_engine";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features } from "./config";
import { DatabaseEngineDeployment } from "./utils/database_engine_deployment";

const itIf = !features.includes(TestEnvironmentFeatures.PERFORMANCE) ? it : it;

let client: any;
let auroraTestUtility: AuroraTestUtility;

async function executeInstanceQuery(client: any, engine: DatabaseEngine, deployment: DatabaseEngineDeployment, props: any): Promise<void> {
  client.on("error", (error: any) => {
    logger.debug(error.message);
  });
  await client.connect();

  const res = await DriverHelper.executeInstanceQuery(engine, deployment, client);

  expect(res).not.toBeNull();
}

beforeEach(async () => {
  logger.info(`Test started: ${expect.getState().currentTestName}`);
  auroraTestUtility = new AuroraTestUtility((await TestEnvironment.getCurrent()).region);
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
  logger.info(`Test finished: ${expect.getState().currentTestName}`);
}, 1320000);

describe("basic_connectivity", () => {
  itIf(
    "wrapper with failover plugins read only endpoint",
    async () => {
      const env = await TestEnvironment.getCurrent();
      const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
      const initClientFunc = DriverHelper.getClient(driver);

      let props = {
        user: env.databaseInfo.username,
        host: env.databaseInfo.clusterReadOnlyEndpoint,
        database: env.databaseInfo.default_db_name,
        password: env.databaseInfo.password,
        port: env.databaseInfo.clusterEndpointPort,
        plugins: "failover,efm"
      };
      props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);
      client = initClientFunc(props);

      await executeInstanceQuery(client, env.engine, env.deployment, props);
    },
    1320000
  );

  itIf(
    "wrapper with failover plugins cluster endpoint",
    async () => {
      const env = await TestEnvironment.getCurrent();
      const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
      const initClientFunc = DriverHelper.getClient(driver);

      let props = {
        user: env.databaseInfo.username,
        host: env.databaseInfo.clusterEndpoint,
        database: env.databaseInfo.default_db_name,
        password: env.databaseInfo.password,
        port: env.databaseInfo.clusterEndpointPort,
        plugins: "failover,efm"
      };
      props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);

      client = initClientFunc(props);
      await executeInstanceQuery(client, env.engine, env.deployment, props);
    },
    1320000
  );

  itIf(
    "wrapper with failover plugins instance endpoint",
    async () => {
      const env = await TestEnvironment.getCurrent();
      const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
      const initClientFunc = DriverHelper.getClient(driver);

      let props = {
        user: env.databaseInfo.username,
        host: env.databaseInfo.instances[0].host,
        database: env.databaseInfo.default_db_name,
        password: env.databaseInfo.password,
        port: env.databaseInfo.clusterEndpointPort,
        plugins: "failover,efm"
      };
      props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);

      client = initClientFunc(props);
      await executeInstanceQuery(client, env.engine, env.deployment, props);
    },
    1320000
  );

  itIf(
    "wrapper",
    async () => {
      const env = await TestEnvironment.getCurrent();
      const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
      const initClientFunc = DriverHelper.getClient(driver);

      let props = {
        user: env.databaseInfo.username,
        host: env.databaseInfo.instances[0].host,
        database: env.databaseInfo.default_db_name,
        password: env.databaseInfo.password,
        port: env.databaseInfo.instanceEndpointPort,
        plugins: ""
      };
      props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);

      client = initClientFunc(props);
      client.on("error", (error: any) => {
        logger.debug(error.message);
      });
      await client.connect();

      const res = await DriverHelper.executeInstanceQuery(env.engine, env.deployment, client);

      expect(res).not.toBeNull();
    },
    1320000
  );

  itIf(
    "wrapper_proxy",
    async () => {
      const env = await TestEnvironment.getCurrent();
      const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
      const initClientFunc = DriverHelper.getClient(driver);

      let props = {
        user: env.databaseInfo.username,
        host: env.proxyDatabaseInfo.instances[0].host,
        database: env.databaseInfo.default_db_name,
        password: env.databaseInfo.password,
        port: env.proxyDatabaseInfo.instanceEndpointPort,
        plugins: "",
        clusterInstanceHostPattern: "?." + env.proxyDatabaseInfo.instanceEndpointSuffix + ":" + env.proxyDatabaseInfo.instanceEndpointPort
      };
      props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);

      client = initClientFunc(props);
      client.on("error", (error: any) => {
        logger.debug(error.message);
      });

      await client.connect();

      await ProxyHelper.disableAllConnectivity(env.engine);

      await expect(async () => {
        await auroraTestUtility.queryInstanceId(client);
      }).rejects.toThrow();

      await ProxyHelper.enableAllConnectivity();
    },
    1320000
  );
});
