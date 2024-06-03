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
import { AwsPGClient } from "pg-wrapper/lib/client";
import { AwsMySQLClient } from "mysql-wrapper/lib/client";
import { DriverHelper } from "./utils/driver_helper";

describe("basic_connectivity", () => {
  it("wrapper", async () => {
    const env = await TestEnvironment.getCurrent();
    const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    const initClientFunc = DriverHelper.getClient(driver);

    const props = {
      user: env.databaseInfo.username,
      host: env.databaseInfo.instances[0].host,
      database: env.databaseInfo.default_db_name,
      password: env.databaseInfo.password,
      port: env.databaseInfo.clusterEndpointPort,
      plugins: ""
    };
    const client: AwsPGClient | AwsMySQLClient = initClientFunc(props);
    await client.connect();

    const res = await DriverHelper.executeInstanceQuery(env.engine, client);

    expect(res).not.toBeNull();
    await client.end();
  }, 1000000);

  it("wrapper_proxy", async () => {
    const env = await TestEnvironment.getCurrent();
    const driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    const initClientFunc = DriverHelper.getClient(driver);

    let props = {
      user: env.databaseInfo.username,
      host: env.proxyDatabaseInfo.instances[0].host,
      database: env.databaseInfo.default_db_name,
      password: env.databaseInfo.password,
      port: env.proxyDatabaseInfo.clusterEndpointPort,
      plugins: ""
    };
    props = DriverHelper.addDriverSpecificConfiguration(props, env.engine);

    const client: AwsPGClient | AwsMySQLClient = initClientFunc(props);

    await client.connect();

    await ProxyHelper.disableAllConnectivity(env.engine);

    await expect(async () => {
      await DriverHelper.executeQuery(env.engine, client, DriverHelper.getSleepQuery(env.engine, 15));
    }).rejects.toThrow();

    await ProxyHelper.enableAllConnectivity();
    await client.end();
  }, 1000000);
});
