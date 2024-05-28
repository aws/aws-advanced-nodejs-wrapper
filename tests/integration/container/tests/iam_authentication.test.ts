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

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;

const auroraTestUtility = new AuroraTestUtility();

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  const env = await TestEnvironment.getCurrent();

  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "iam"
  };
  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
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
    config["user"] = `WRONG_${config}_USER`;
    logger.error(config);
    const client = initClientFunc(config);

    expect(async () => {
      await client.connect();
    }).toThrow(AwsWrapperError);
    await client.end();
  }, 1000000);

  it("testIamNoDatabaseUsername", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    config["user"] = "";
    const client = initClientFunc(config);

    expect(async () => {
      await client.connect();
    }).toThrow(AwsWrapperError);

    await client.end();
  }, 1000000);

  it("testIamInvalidHost", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    config["iam_host"] = "<>";
    const client = initClientFunc(config);

    expect(async () => {
      await client.connect();
    }).toThrow(AwsWrapperError);

    await client.end();
  }, 1000000);

  it("testIamUsingIpAddress", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    const instance = env.writer;
    const ip_address = instance.host;

    config["host"] = ip_address;
  });
});
