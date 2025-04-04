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
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features, instanceCount } from "./config";
import { PluginManager } from "../../../../common/lib";
import { CreateSecretCommand, CreateSecretCommandOutput, DeleteSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { RDSClient } from "@aws-sdk/client-rds";
import { AuroraTestUtility } from "./utils/aurora_test_utility";
import { ProxyHelper } from "./utils/proxy_helper";
import { instance } from "ts-mockito";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  features.includes(TestEnvironmentFeatures.IAM) &&
  instanceCount == 2
    ? it
    : it.skip;

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;
let secretId: string;
let secretARN: string;
let secretsManagerClient: RDSClient;
let auroraTestUtility: AuroraTestUtility;

async function initDefaultConfig(host: string): Promise<any> {
  env = await TestEnvironment.getCurrent();
  let props = {
    host: host,
    database: env.databaseInfo.defaultDbName,
    port: env.databaseInfo.instanceEndpointPort,
    secretRegion: env.region,
    secretId: secretId,
    plugins: "secretsManager"
  };
  props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);

  return props;
}

async function initSecretARNConfig(host: string): Promise<any> {
  env = await TestEnvironment.getCurrent();

  let props = {
    host: host,
    database: env.databaseInfo.defaultDbName,
    port: env.databaseInfo.instanceEndpointPort,
    region: "us-east-1",
    secretId: secretARN,
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

async function createCommand(secretName: string) {
  const secretObj = {
    engine: `${env.engine}`,
    username: `${env.databaseInfo.username}`,
    password: `${env.databaseInfo.password}`,
    host: `${env.databaseInfo.writerInstanceEndpoint}`,
    dbname: `${env.databaseInfo.defaultDbName}`,
    port: `${env.databaseInfo.instanceEndpointPort}`
  };
  const input = {
    Name: secretName,
    ForceOverwriteReplicaSecret: true,
    SecretString: JSON.stringify(secretObj)
  };

  const command = new CreateSecretCommand(input);
  const result: CreateSecretCommandOutput = await secretsManagerClient.send(command);
  secretId = result.Name;
  secretARN = result.ARN;
}

async function deleteCommand() {
  const deleteInput = { SecretId: secretId, ForceDeleteWithoutRecovery: true };
  const command = new DeleteSecretCommand(deleteInput);
  await secretsManagerClient.send(command);
}

describe("aurora secrets manager", () => {
  beforeAll(async () => {
    env = await TestEnvironment.getCurrent();
    secretsManagerClient = new SecretsManagerClient({ region: env.region });
    auroraTestUtility = new AuroraTestUtility(env.region);
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();

    await TestEnvironment.verifyClusterStatus();
  }, 1000000);

  afterAll(async () => {
    secretsManagerClient.destroy();
  });

  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    auroraTestUtility = new AuroraTestUtility(env.region);
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    await TestEnvironment.verifyClusterStatus();
  }, 1320000);

  afterEach(async () => {
    if (secretId != null) {
      await deleteCommand();
    }
    secretId = null;
    secretARN = null;
    await PluginManager.releaseResources();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  itIf(
    "secrets manager wrong secretId",
    async () => {
      await createCommand("wrongSecretId");

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
      await createCommand("invalidRegion");

      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["secretId"] = secretId;
      config["secretRegion"] = "<>";
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

      await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
    },
    100000
  );

  itIf(
    "secrets manager valid connection properties",
    async () => {
      await createCommand("validConnectionProperties");

      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["secretId"] = secretId;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);
      await validateConnection(client);
    },
    100000
  );

  itIf(
    "secrets manager valid connection properties ARN",
    async () => {
      await createCommand("validSecretARN");

      const config = await initSecretARNConfig(env.databaseInfo.writerInstanceEndpoint);
      // Region not required if secret is ARN.
      config["secretId"] = secretARN;
      config["region"] = undefined;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);
      await validateConnection(client);
    },
    100000
  );

  itIf(
    "secrets manager valid connection properties ARN with password",
    async () => {
      await createCommand("validSecretARNWithPassword");
      const config = await initSecretARNConfig(env.databaseInfo.writerInstanceEndpoint);
      config["secretId"] = secretARN;
      // Password is not needed.
      config["password"] = "anything";
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);
      await validateConnection(client);
    },
    100000
  );
});
