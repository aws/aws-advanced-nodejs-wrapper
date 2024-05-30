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
import { AwsWrapperError } from "aws-wrapper-common-lib/lib/utils/errors";
import { ProxyHelper } from "./utils/proxy_helper";
import { logger } from "aws-wrapper-common-lib/logutils";
import { QueryResult } from "pg";
import { promisify } from "util";
import { lookup } from "dns";
import { readFileSync } from "fs";

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;

const sslCertificate = {
  ca: readFileSync("/app/global-bundle.pem").toString()
};

async function validateConnection(client: any) {
  await client.connect();
  const res: QueryResult = await client.query("select now()");
  expect(res.rowCount).toBe(1);
  await client.end();
}

async function getIpAddress(host: string) {
  return promisify(lookup)(host, {});
}

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  const env = await TestEnvironment.getCurrent();

  const config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "iam",
    ssl: sslCertificate
  };
  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  return config;
}

describe("iamTests", () => {
  beforeAll(async () => {
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
  });

  beforeEach(async () => {
    await ProxyHelper.enableAllConnectivity();
  });

  it("testIamWrongDatabaseUsername", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    config["user"] = `WRONG_IAM_USER`;
    const client = initClientFunc(config);

    client.on("error", (error: any) => {
      console.log(error);
    });

    await expect(client.connect()).rejects.toThrow(`password authentication failed for user "WRONG_IAM_USER"`);
  }, 1000000);

  it("testIamNoDatabaseUsername", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    config["user"] = undefined;
    const client = initClientFunc(config);

    client.on("error", (error: any) => {
      console.log(error);
    });

    await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
  }, 1000000);

  it("testIamInvalidHost", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    config["iamHost"] = "<>";
    const client = initClientFunc(config);

    await expect(client.connect()).rejects.toBeInstanceOf(AwsWrapperError);
  }, 1000000);

  it("testIamUsingIpAddress", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    const instance = env.writer;
    if (instance.host) {
      const ip = await getIpAddress(instance.host);
      // console.log(ip.address);
      // console.log(instance.host);
      // TODO: can't connect by ip
      config["host"] = ip.address;
      config["user"] = "jane_doe";
      config["password"] = "anything";
      config["iamHost"] = instance.host;
      const client = initClientFunc(config);

      await validateConnection(client);
    } else {
      throw new AwsWrapperError("Host not found");
    }
  }, 1000000);

  it("testIamValidConnectionProperties", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    config["user"] = "jane_doe";
    config["password"] = "anything";
    const client = initClientFunc(config);
    await validateConnection(client);
  }, 1000000);

  it("testIamValidConnectionPropertiesNoPassword", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    config["user"] = "jane_doe";
    config["password"] = undefined;
    config["ssl"] = sslCertificate;
    const client = initClientFunc(config);
    await validateConnection(client);
  }, 1000000);
});
