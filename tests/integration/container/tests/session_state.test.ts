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
import { logger } from "../../../../common/logutils";
import { DatabaseEngine } from "./utils/database_engine";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features } from "./config";
import { DatabaseEngineDeployment } from "./utils/database_engine_deployment";
import { PluginManager } from "../../../../common/lib";
import { AwsPGClient } from "../../../../pg/lib";
import { PluginService } from "../../../../common/lib/plugin_service";
import { TestDriver } from "./utils/test_driver";
import { AwsMySQLClient } from "../../../../mysql/lib";
import { TransactionIsolationLevel } from "../../../../common/lib/utils/transaction_isolation_level";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) && !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) ? it : it.skip;

let client: any;

async function executeInstanceQuery(client: any, engine: DatabaseEngine, deployment: DatabaseEngineDeployment, props: any): Promise<void> {
  await client.connect();

  const res = await DriverHelper.executeInstanceQuery(engine, deployment, client);

  expect(res).not.toBeNull();
}

beforeEach(async () => {
  logger.info(`Test started: ${expect.getState().currentTestName}`);
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

class TestAwsMySQLClient extends AwsMySQLClient {
  getPluginService(): PluginService {
    return this.pluginService;
  }
}

class TestAwsPGClient extends AwsPGClient {
  getPluginService(): PluginService {
    return this.pluginService;
  }
}

describe("session state", () => {
  itIf(
    "test update state",
    async () => {
      const env = await TestEnvironment.getCurrent();
      const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
      let initClientFunc;
      switch (driver) {
        case TestDriver.MYSQL:
          initClientFunc = (options: any) => new TestAwsMySQLClient(options);
          break;
        case TestDriver.PG:
          initClientFunc = (options: any) => new TestAwsPGClient(options);
          break;
        default:
          throw new Error("invalid driver");
      }

      let props = {
        user: env.databaseInfo.username,
        host: env.databaseInfo.clusterReadOnlyEndpoint,
        database: env.databaseInfo.default_db_name,
        password: env.databaseInfo.password,
        port: env.databaseInfo.clusterEndpointPort
      };
      props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);
      client = initClientFunc(props);

      const newClient = initClientFunc(props);

      try {
        await client.connect();
        await newClient.connect();

        if (driver === TestDriver.MYSQL) {
          await newClient.setReadOnly(true);
          await newClient.setAutoCommit(false);
          await newClient.setCatalog("test");
          await newClient.setTransactionIsolation(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);

          await client.getPluginService().setCurrentClient(newClient.targetClient);

          expect(client.targetClient.sessionState.readOnly.value).toBe(true);
          expect(client.targetClient.sessionState.autoCommit.value).toBe(false);
          expect(client.targetClient.sessionState.catalog.value).toBe("test");
          expect(client.targetClient.sessionState.schema.value).toBe(undefined);
          expect(client.targetClient.sessionState.transactionIsolation.value).toBe(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);
        } else if (driver === TestDriver.PG) {
          await newClient.setReadOnly(true);
          await newClient.setSchema("test");
          await newClient.setTransactionIsolation(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);

          await client.getPluginService().setCurrentClient(newClient.targetClient);

          expect(client.targetClient.sessionState.readOnly.value).toBe(true);
          expect(client.targetClient.sessionState.autoCommit.value).toBe(undefined);
          expect(client.targetClient.sessionState.catalog.value).toBe(undefined);
          expect(client.targetClient.sessionState.schema.value).toBe("test");
          expect(client.targetClient.sessionState.transactionIsolation.value).toBe(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);
        }
      } catch (e) {
        await client.end();
        await newClient.end();
        throw e;
      }
    },
    1320000
  );
});
