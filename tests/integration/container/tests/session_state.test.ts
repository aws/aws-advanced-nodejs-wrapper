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
        host: env.databaseInfo.clusterEndpoint,
        database: env.databaseInfo.defaultDbName,
        password: env.databaseInfo.password,
        port: env.databaseInfo.clusterEndpointPort
      };
      props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);
      client = initClientFunc(props);

      const newClient = initClientFunc(props);

      try {
        await client.connect();
        await newClient.connect();
        const targetClient = client.targetClient;
        const newTargetClient = newClient.targetClient;

        expect(targetClient).not.toEqual(newTargetClient);
        if (driver === TestDriver.MYSQL) {
          await DriverHelper.executeQuery(env.engine, client, "CREATE DATABASE IF NOT EXISTS testSessionState");
          await client.setReadOnly(true);
          await client.setCatalog("testSessionState");
          await client.setTransactionIsolation(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);
          await client.setAutoCommit(false);

          // Assert new client's session states are using server default values.
          let readOnly = await DriverHelper.executeQuery(env.engine, newClient, "SELECT @@SESSION.transaction_read_only AS readonly");
          let catalog = await DriverHelper.executeQuery(env.engine, newClient, "SELECT DATABASE() AS catalog");
          let autoCommit = await DriverHelper.executeQuery(env.engine, newClient, "SELECT @@SESSION.autocommit AS autocommit");
          let transactionIsolation = await DriverHelper.executeQuery(env.engine, newClient, "SELECT @@SESSION.transaction_isolation AS level");
          expect(readOnly[0][0].readonly).toEqual(0);
          expect(catalog[0][0].catalog).toEqual(env.databaseInfo.defaultDbName);
          expect(autoCommit[0][0].autocommit).toEqual(1);
          expect(transactionIsolation[0][0].level).toEqual("REPEATABLE-READ");

          await client.getPluginService().setCurrentClient(newClient.targetClient);

          expect(client.targetClient).not.toEqual(targetClient);
          expect(client.targetClient).toEqual(newTargetClient);

          // Assert new client's session states are set.
          readOnly = await DriverHelper.executeQuery(env.engine, newClient, "SELECT @@SESSION.transaction_read_only AS readonly");
          catalog = await DriverHelper.executeQuery(env.engine, newClient, "SELECT DATABASE() AS catalog");
          autoCommit = await DriverHelper.executeQuery(env.engine, newClient, "SELECT @@SESSION.autocommit AS autocommit");
          transactionIsolation = await DriverHelper.executeQuery(env.engine, newClient, "SELECT @@SESSION.transaction_isolation AS level");
          expect(readOnly[0][0].readonly).toEqual(1);
          expect(catalog[0][0].catalog).toEqual("testSessionState");
          expect(autoCommit[0][0].autocommit).toEqual(0);
          expect(transactionIsolation[0][0].level).toEqual("SERIALIZABLE");

          await client.setReadOnly(false);
          await client.setAutoCommit(true);
          await DriverHelper.executeQuery(env.engine, client, "DROP DATABASE IF EXISTS testSessionState");
        } else if (driver === TestDriver.PG) {
          // End any current transaction before we can create a new test database.
          await DriverHelper.executeQuery(env.engine, client, "END TRANSACTION");
          await DriverHelper.executeQuery(env.engine, client, "DROP DATABASE IF EXISTS testSessionState");
          await DriverHelper.executeQuery(env.engine, client, "CREATE DATABASE testSessionState");
          await client.setReadOnly(true);
          await client.setSchema("testSessionState");
          await client.setTransactionIsolation(TransactionIsolationLevel.TRANSACTION_SERIALIZABLE);

          // Assert new client's session states are using server default values.
          let readOnly = await DriverHelper.executeQuery(env.engine, newClient, "SHOW transaction_read_only");
          let schema = await DriverHelper.executeQuery(env.engine, newClient, "SHOW search_path");
          let transactionIsolation = await DriverHelper.executeQuery(env.engine, newClient, "SHOW TRANSACTION ISOLATION LEVEL");
          expect(readOnly.rows[0]["transaction_read_only"]).toEqual("off");
          expect(schema.rows[0]["search_path"]).not.toEqual("testSessionState");
          expect(transactionIsolation.rows[0]["transaction_isolation"]).toEqual("read committed");

          await client.getPluginService().setCurrentClient(newClient.targetClient);
          expect(client.targetClient).not.toEqual(targetClient);
          expect(client.targetClient).toEqual(newTargetClient);

          // Assert new client's session states are set.
          readOnly = await DriverHelper.executeQuery(env.engine, newClient, "SHOW transaction_read_only");
          schema = await DriverHelper.executeQuery(env.engine, newClient, "SHOW search_path");
          transactionIsolation = await DriverHelper.executeQuery(env.engine, newClient, "SHOW TRANSACTION ISOLATION LEVEL");
          expect(readOnly.rows[0]["transaction_read_only"]).toEqual("on");
          expect(schema.rows[0]["search_path"]).toEqual("testsessionstate");
          expect(transactionIsolation.rows[0]["transaction_isolation"]).toEqual("serializable");

          await client.setReadOnly(false);
          await DriverHelper.executeQuery(env.engine, client, "DROP DATABASE IF EXISTS testSessionState");
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
