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
import { promisify } from "util";
import { lookup } from "dns";
import { readFileSync } from "fs";
import { AwsPGClient } from "../../../../pg/lib";
import { AwsMySQLClient } from "../../../../mysql/lib";
import { IamAuthenticationPlugin } from "../../../../common/lib/authentication/iam_authentication_plugin";
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features } from "./config";
import { PluginManager } from "../../../../common/lib";
import { jest } from "@jest/globals";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  features.includes(TestEnvironmentFeatures.IAM)
    ? it
    : it.skip;

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;

const sslCertificate = {
  ca: readFileSync("/app/global-bundle.pem").toString()
};

function getIpAddress(host: string) {
  return promisify(lookup)(host, {});
}

async function initDefaultConfig(host: string): Promise<any> {
  env = await TestEnvironment.getCurrent();

  let props = {
    user: "jane_doe",
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: env.databaseInfo.instanceEndpointPort,
    plugins: "iam",
    ssl: sslCertificate,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP"
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

describe("iam authentication", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    jest.useFakeTimers({
      doNotFake: ["nextTick"]
    });
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    IamAuthenticationPlugin.clearCache();
  });

  afterEach(async () => {
    await PluginManager.releaseResources();
    await TestEnvironment.verifyClusterStatus();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  afterAll(async () => {
    await jest.runOnlyPendingTimersAsync();
    jest.useRealTimers();
  });

  itIf(
    "iam wrong database username",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["user"] = `WRONG_${env.info.databaseInfo.username}_USER`;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

      await expect(client.connect()).rejects.toThrow();
    },
    100000
  );

  itIf(
    "iam no database username",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["user"] = undefined;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

      await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
    },
    100000
  );

  itIf(
    "iam invalid host",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["iamHost"] = "<>";
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

      await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
    },
    100000
  );

  // Currently, PG cannot connect to an IP address with SSL enabled, skip if PG
  itIf(
    "iam using ip address",
    async () => {
      if (env.engine === "MYSQL") {
        const instance = env.writer;
        if (instance.host) {
          const ip = await getIpAddress(instance.host);
          const config = await initDefaultConfig(ip.address);

          config["password"] = "anything";
          config["iamHost"] = instance.host;

          const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

          await validateConnection(client);
        } else {
          throw new AwsWrapperError("Host not found");
        }
      }
    },
    100000
  );

  itIf(
    "iam valid connection properties",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["password"] = "anything";
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);
      await validateConnection(client);
    },
    100000
  );

  itIf(
    "iam valid connection properties no password",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["password"] = undefined;
      const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);
      await validateConnection(client);
    },
    100000
  );
});
