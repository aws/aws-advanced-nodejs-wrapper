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
    ssl: sslCertificate
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
    await client.end();
  }
}

describe("iam authentication", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    IamAuthenticationPlugin.clearCache();
  });

  afterEach(async () => {
    await TestEnvironment.updateWriter();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1000000);

  it("iam wrong database username", async () => {
    const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
    config["user"] = `WRONG_${env.info.databaseInfo.username}_USER`;
    const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(error.message);
    });

    await expect(client.connect()).rejects.toThrow();
  }, 100000);

  it("iam no database username", async () => {
    const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
    config["user"] = undefined;
    const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(error.message);
    });

    await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
  }, 100000);

  it("iam invalid host", async () => {
    const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
    config["iamHost"] = "<>";
    const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(error.message);
    });

    await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
  }, 100000);

  // Currently, PG cannot connect to an IP address with SSL enabled, skip if PG
  it("iam using ip address", async () => {
    if (env.engine === "MYSQL") {
      const instance = env.writer;
      if (instance.host) {
        const ip = await getIpAddress(instance.host);
        const config = await initDefaultConfig(ip.address);

        config["password"] = "anything";
        config["iamHost"] = instance.host;

        const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

        client.on("error", (error: any) => {
          logger.debug(error.message);
        });

        await validateConnection(client);
      } else {
        throw new AwsWrapperError("Host not found");
      }
    }
  }, 100000);

  it("iam valid connection properties", async () => {
    const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
    config["password"] = "anything";
    const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(error.message);
    });

    await validateConnection(client);
  }, 100000);

  it("iam valid connection properties no password", async () => {
    const config = await initDefaultConfig(env.databaseInfo.writerInstanceEndpoint);
    config["password"] = undefined;
    const client: AwsPGClient | AwsMySQLClient = initClientFunc(config);

    client.on("error", (error: any) => {
      logger.debug(error.message);
    });

    await validateConnection(client);
  }, 100000);
});
