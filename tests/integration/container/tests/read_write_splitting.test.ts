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
import { AwsWrapperError, FailoverSuccessError } from "aws-wrapper-common-lib/lib/utils/errors";
import { DatabaseEngine } from "./utils/database_engine";
import { QueryResult } from "pg";
import { ProxyHelper } from "./utils/proxy_helper";

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
    plugins: "readWriteSplitting"
  };

  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function initConfigWithFailover(host: string, port: number, connectToProxy: boolean): Promise<any> {
  const env = await TestEnvironment.getCurrent();

  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.default_db_name,
    password: env.databaseInfo.password,
    port: port,
    plugins: "readWriteSplitting,failover",
    failoverTimeoutMs: 400000,
    failoverMode: "reader-or-writer"
  };

  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

describe("aurora read write splitting", () => {
  beforeAll(async () => {
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
  });

  beforeEach(async () => {
    await ProxyHelper.enableAllConnectivity();
  });

  it("test connect to writer switch set read only", async () => {

    console.log("test1");
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    const client = initClientFunc(config);

    client.on("error", (error: any) => {
      console.log(error);
    });

    await client.connect();
    const initialWriterId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(initialWriterId)).toBe(true);

    await client.setReadOnly(true);
    const readerId = await auroraTestUtility.queryInstanceId(client);
    expect(readerId).not.toBe(initialWriterId);

    await client.setReadOnly(true);
    const currentId0 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId0).toBe(readerId);

    await client.setReadOnly(false);
    const currentId1 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId1).toBe(initialWriterId);

    await client.setReadOnly(false);
    const currentId2 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId2).toBe(initialWriterId);

    await client.setReadOnly(true);
    const currentId3 = await auroraTestUtility.queryInstanceId(client);
    expect(currentId3).toBe(readerId);
    expect(await auroraTestUtility.isDbInstanceWriter(currentId3)).toBe(false);

    await client.end();
  }, 9000000);

  it("test set read only false in read only transaction", async () => {
    const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
    const client = initClientFunc(config);
    console.log("test2");


    client.on("error", (error: any) => {
      console.log(error);
    });

    await client.connect();
    const initialWriterId = await auroraTestUtility.queryInstanceId(client);

    await client.setReadOnly(true);
    const initialReaderId = await auroraTestUtility.queryInstanceId(client);
    expect(initialReaderId).not.toBe(initialWriterId);

    await DriverHelper.executeQuery(env.engine, client, "START TRANSACTION READ ONLY"); // start transaction
    await DriverHelper.executeQuery(env.engine, client, "SELECT 1");

    try {
      await client.setReadOnly(false);
    } catch (error) {
      console.log(error);
      if (!(error instanceof AwsWrapperError)) {
        throw new Error("Resulting error type incorrect");
      }
    }
    const currentConnectionId0 = await auroraTestUtility.queryInstanceId(client);
    expect(currentConnectionId0).toBe(initialReaderId);

    await DriverHelper.executeQuery(env.engine, client, "COMMIT");

    await client.setReadOnly(false);
    const currentConnectionId1 = await auroraTestUtility.queryInstanceId(client);
    expect(currentConnectionId1).toBe(initialWriterId);

    await client.end();
  }, 9000000);

  // it("test set read only true in transaction", async () => {
  //   const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
  //   const client = initClientFunc(config);
  //   console.log("test3");
  //
  //   client.on("error", (error: any) => {
  //     console.log(error);
  //   });
  //
  //   await client.connect();
  //   const initialWriterId = await auroraTestUtility.queryInstanceId(client);
  //
  //   await DriverHelper.executeQuery(env.engine, client, "DROP TABLE IF EXISTS test3_3");
  //   await DriverHelper.executeQuery(env.engine, client, "CREATE TABLE test3_3 (id int not null primary key, test3_3_field varchar(255) not null)");
  //
  //   await DriverHelper.executeQuery(env.engine, client, "START TRANSACTION"); // start transaction
  //   await DriverHelper.executeQuery(env.engine, client, "INSERT INTO test3_3 VALUES (1, 'test field string 1')");
  //
  //   await client.setReadOnly(true);
  //   const currentReaderId = await auroraTestUtility.queryInstanceId(client);
  //   expect(currentReaderId).toBe(initialWriterId);
  //
  //   await DriverHelper.executeQuery(env.engine, client, "COMMIT");
  //
  //   // Assert that 1 row has been inserted to the table.
  //   const result = await DriverHelper.executeQuery(env.engine, client, "SELECT count(*) from test3_3");
  //   if (env.engine === DatabaseEngine.PG) {
  //     expect((result as QueryResult).rows[0]["count"]).toBe("1");
  //   } else if (env.engine === DatabaseEngine.MYSQL) {
  //     expect(JSON.parse(JSON.stringify(result))[0][0]["count(*)"]).toBe(1);
  //   }
  //   await client.setReadOnly(false);
  //   const currentConnectionId1 = await auroraTestUtility.queryInstanceId(client);
  //   expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId1)).toBe(true);
  //   expect(currentConnectionId1).toBe(initialWriterId);
  //
  //   await DriverHelper.executeQuery(env.engine, client, "DROP TABLE IF EXISTS test3_3");
  //
  //   await client.end();
  // }, 9000000);

  it("test set read only all readers down", async () => {
    // Connect to writer instance
    const config = await initDefaultConfig(env.proxyDatabaseInfo.clusterEndpoint, env.proxyDatabaseInfo.clusterEndpointPort, true);
    const client = initClientFunc(config);
    client.on("error", (err: any) => {
      console.log(err);
    });
    console.log("test4");

    await client.connect();
    const writerId = await auroraTestUtility.queryInstanceId(client);
    expect(await auroraTestUtility.isDbInstanceWriter(writerId)).toBe(true);

    // Kill all reader instances
    for (const host of env.proxyDatabaseInfo.instances) {
      if (host.instanceId && host.instanceId !== writerId) {
        await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
      }
    }

    await client.setReadOnly(true);
    const currentReaderId0 = await auroraTestUtility.queryInstanceId(client);
    expect(currentReaderId0).toBe(writerId);

    await client.setReadOnly(false);
    const currentReaderId1 = await auroraTestUtility.queryInstanceId(client);
    expect(currentReaderId1).toBe(writerId);

    await ProxyHelper.enableAllConnectivity();
    await client.setReadOnly(true);
    const currentReaderId2 = await auroraTestUtility.queryInstanceId(client);
    expect(currentReaderId2).not.toBe(writerId);

    await client.end();
  }, 9000000);

  // it("test set read only all instances down", async () => {
  //   const config = await initDefaultConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort, false);
  //   const client = initClientFunc(config);
  //   console.log("test5");
  //
  //
  //   client.on("error", (error: any) => {
  //     console.log(error);
  //   });
  //   await client.connect();
  //   const writerId = await auroraTestUtility.queryInstanceId(client);
  //
  //   await client.setReadOnly(true);
  //   const currentReaderId0 = await auroraTestUtility.queryInstanceId(client);
  //   expect(currentReaderId0).not.toBe(writerId);
  //
  //   // Kill all  instances
  //   await ProxyHelper.disableAllConnectivity(env.engine);
  //
  //   try {
  //     await client.setReadOnly(false);
  //   } catch (error) {
  //     console.log(error);
  //
  //     if (!(error instanceof AwsWrapperError)) {
  //       throw new Error("read write splitting all instances down failed");
  //     }
  //   }
  //   await client.end();
  // }, 9000000);

  // Uncomment these tests when failover implementation is complete
  // it("test failover to new writer set read only true false", async () => {
  //   // Connect to writer instance
  //   const writerConfig = await initConfigWithFailover(env.proxyDatabaseInfo.clusterEndpoint, env.proxyDatabaseInfo.clusterEndpointPort, true);
  //   const writerClient = initClientFunc(writerConfig);
  //   writerClient.on("error", (err: any) => {
  //     console.log(err);
  //   });
  //   await writerClient.connect();
  //   const initialWriterId = await auroraTestUtility.queryInstanceId(writerClient);
  //
  //   // Kill all reader instances
  //   for (const host of env.proxyDatabaseInfo.instances) {
  //     if (host.instanceId && host.instanceId !== initialWriterId) {
  //       await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
  //     }
  //   }
  //
  //   // Force internal reader connection to the writer instance
  //   await writerClient.setReadOnly(true);
  //   const currentReaderId0 = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentReaderId0).toBe(initialWriterId);
  //
  //   await writerClient.setReadOnly(false);
  //
  //   await ProxyHelper.enableAllConnectivity();
  //
  //   // Crash instance 1 and nominate a new writer
  //   await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged();
  //
  //   try {
  //     await auroraTestUtility.queryInstanceId(writerClient);
  //     throw new Error("Failover did not occur");
  //   } catch (error: any) {
  //     if (!(error instanceof FailoverSuccessError)) {
  //       throw new Error("Failover failed");
  //     }
  //   }
  //   const newWriterId = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(await auroraTestUtility.isDbInstanceWriter(newWriterId)).toBe(true);
  //   expect(newWriterId).not.toBe(initialWriterId);
  //
  //   await writerClient.setReadOnly(true);
  //   const currentReaderId = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentReaderId).not.toBe(newWriterId);
  //
  //   await writerClient.setReadOnly(false);
  //   const currentId = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentId).toBe(newWriterId);
  //
  //   await writerClient.end();
  // }, 1000000);
  //
  // it("test failover to new reader set read only false true", async () => {
  //   // Connect to writer instance
  //   const writerConfig = await initConfigWithFailover(env.proxyDatabaseInfo.clusterEndpoint, env.proxyDatabaseInfo.clusterEndpointPort, true);
  //   const writerClient = initClientFunc(writerConfig);
  //   writerClient.on("error", (err: any) => {
  //     console.log(err);
  //   });
  //   await writerClient.connect();
  //   const initialWriterId = await auroraTestUtility.queryInstanceId(writerClient);
  //   await writerClient.setReadOnly(true);
  //
  //   const otherReaderId = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(otherReaderId).not.toBe(initialWriterId);
  //
  //   // Get a reader instance
  //   let readerInstanceHost;
  //   let readerInstanceHostId;
  //   for (const host of env.proxyDatabaseInfo.instances) {
  //     if (host.instanceId && host.instanceId !== otherReaderId && host.instanceId !== initialWriterId) {
  //       readerInstanceHost = host.host;
  //       readerInstanceHostId = host.instanceId;
  //       break;
  //     }
  //   }
  //
  //   if (!readerInstanceHost) {
  //     throw new Error("Could not find a reader instance");
  //   }
  //
  //   // Kill all instances except one other reader
  //   for (const host of env.proxyDatabaseInfo.instances) {
  //     if (host.instanceId && host.instanceId !== otherReaderId) {
  //       await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
  //     }
  //   }
  //
  //   try {
  //     await auroraTestUtility.queryInstanceId(writerClient);
  //   } catch (error) {
  //     console.log(error);
  //
  //     if (!(error instanceof FailoverSuccessError)) {
  //       console.log(error);
  //       throw new Error("failover success failed");
  //     }
  //   }
  //
  //   const currentReaderId0 = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentReaderId0).toBe(otherReaderId);
  //   expect(currentReaderId0).not.toBe(readerInstanceHostId);
  //
  //   await ProxyHelper.enableAllConnectivity();
  //
  //   await writerClient.setReadOnly(false);
  //   const currentReaderId1 = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentReaderId1).toBe(initialWriterId);
  //
  //   await writerClient.setReadOnly(true);
  //   const currentReaderId2 = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentReaderId2).toBe(otherReaderId);
  //
  //   await writerClient.end();
  // }, 1000000);
  //
  // it("test failover to new writer set read only true false", async () => {
  //   // Connect to writer instance
  //   const writerConfig = await initConfigWithFailover(env.proxyDatabaseInfo.clusterEndpoint, env.proxyDatabaseInfo.clusterEndpointPort, true);
  //   const writerClient = initClientFunc(writerConfig);
  //   writerClient.on("error", (err: any) => {
  //     console.log(err);
  //   });
  //   await writerClient.connect();
  //   const initialWriterId = await auroraTestUtility.queryInstanceId(writerClient);
  //   await writerClient.setReadOnly(true);
  //
  //   const currentReaderId = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentReaderId).not.toBe(initialWriterId);
  //
  //   // Kill all instances except the writer
  //   for (const host of env.proxyDatabaseInfo.instances) {
  //     if (host.instanceId && host.instanceId !== initialWriterId) {
  //       await ProxyHelper.disableConnectivity(env.engine, host.instanceId);
  //     }
  //   }
  //   try {
  //     await auroraTestUtility.queryInstanceId(writerClient);
  //   } catch (error) {
  //     console.log(error);
  //
  //     if (!(error instanceof FailoverSuccessError)) {
  //       throw new Error("failover success failed");
  //     }
  //   }
  //
  //   const currentId0 = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentId0).toBe(initialWriterId);
  //
  //   await ProxyHelper.enableAllConnectivity();
  //
  //   await writerClient.setReadOnly(true);
  //   const currentId1 = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentId1).not.toBe(initialWriterId);
  //
  //   await writerClient.setReadOnly(false);
  //   const currentId2 = await auroraTestUtility.queryInstanceId(writerClient);
  //   expect(currentId2).toBe(initialWriterId);
  //
  //   await writerClient.end();
  // }, 1000000);
});
