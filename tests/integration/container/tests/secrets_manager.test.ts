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
import { AwsWrapperError } from "../../../../common/lib/utils/errors";
import { AwsPGClient } from "../../../../pg/lib";
import { AwsMySQLClient } from "../../../../mysql/lib";
import { IamAuthenticationPlugin } from "../../../../common/lib/authentication/iam_authentication_plugin";
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features } from "./config";
import { PluginManager } from "../../../../common/lib";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  features.includes(TestEnvironmentFeatures.IAM)
    ? it
    : it.skip;

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;

async function initDefaultConfig(host: string): Promise<any> {
  env = await TestEnvironment.getCurrent();

  let props = {
    host: host,
    port: env.databaseInfo.instanceEndpointPort,
    secretRegion: env.region,
    secretId: env.secretId,
    plugins: "secretsManager"
  };
  props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);
  return props;
}

async function validateConnection(client: AwsPGClient | AwsMySQLClient) {
  try {
    await client.connect();
    const res = await DriverHelper.executeQuery(env.engine, client, "select 1");
    expect(res).not.toBeNull();
  } finally {
    try {
      await client.end();
    } catch (error) {
      // pass
    }
  }
}

describe("aurora secrets manager", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    IamAuthenticationPlugin.clearCache();
    await TestEnvironment.verifyClusterStatus();
  });

  afterEach(async () => {
    await PluginManager.releaseResources();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  itIf(
    "secrets manager wrong secretId",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["secretId"] = `WRONG_${env.info.databaseInfo.username}_USER`;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

      await expect(client.connect()).rejects.toThrow();
    },
    100000
  );

  itIf(
    "secrets manager no secretId",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["secretId"] = undefined;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

      await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
    },
    100000
  );

  itIf(
    "secrets manager invalid region",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["region"] = "<>";
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

      await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
    },
    100000
  );

  itIf(
    "secrets manager valid connection properties",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["password"] = "anything";
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);
      await validateConnection(client);
    },
    100000
  );

  itIf(
    "secrets manager valid connection properties no password",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["password"] = undefined;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);
      await validateConnection(client);
    },
    100000
  );
});
