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
import { AwsWrapperError, PluginManager } from "../../../../index";
import { promisify } from "util";
import { lookup } from "dns";
import { readFileSync } from "fs";
import { logger } from "../../../../common/logutils";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features } from "./config";
import { jest } from "@jest/globals";

const itIf =
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  features.includes(TestEnvironmentFeatures.IAM)
    ? it
    : it.skip;

let env: TestEnvironment;
let driver: any;
let initClientFunc: (props: any) => any;
let client: any;
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
    database: env.databaseInfo.defaultDbName,
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

async function validateConnection() {
  await client.connect();
  const res = await DriverHelper.executeQuery(env.engine, client, "select 1");
  expect(res).not.toBeNull();
}

describe("iam authentication", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    jest.useFakeTimers({
      doNotFake: ["nextTick"]
    });
    client = null;
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await PluginManager.releaseResources();
  });

  afterEach(async () => {
    try {
      await client.end();
    } catch (error) {
      // pass
    }
    await PluginManager.releaseResources();
    await TestEnvironment.verifyClusterStatus();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  afterAll(async () => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  itIf(
    "iam wrong database username",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["user"] = `WRONG_${env.info.databaseInfo.username}_USER`;
      client = initClientFunc(config);

      await expect(client.connect()).rejects.toThrow();
    },
    100000
  );

  itIf(
    "iam no database username",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["user"] = undefined;
      client = initClientFunc(config);

      await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
    },
    100000
  );

  itIf(
    "iam invalid host",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["iamHost"] = "<>";
      client = initClientFunc(config);

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

          client = initClientFunc(config);

          await validateConnection();
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
      client = initClientFunc(config);
      await validateConnection();
    },
    100000
  );

  itIf(
    "iam valid connection properties no password",
    async () => {
      const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
      config["password"] = undefined;
      client = initClientFunc(config);
      await validateConnection();
    },
    100000
  );
});
