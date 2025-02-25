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

import { features, instanceCount } from "./config";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { TestEnvironment } from "./utils/test_environment";
import { AuroraTestUtility } from "./utils/aurora_test_utility";
import { DriverHelper } from "./utils/driver_helper";
import { AwsWrapperError, FailoverSuccessError } from "../../../../common/lib/utils/errors";
import {
  CreateDBClusterEndpointCommand,
  DBClusterEndpoint,
  DeleteDBClusterEndpointCommand,
  DescribeDBClusterEndpointsCommand,
  ModifyDBClusterEndpointCommand,
  RDSClient
} from "@aws-sdk/client-rds";
import { sleep } from "../../../../common/lib/utils/utils";
import { randomUUID } from "node:crypto";
import { TestInstanceInfo } from "./utils/test_instance_info";
import { logger } from "../../../../common/logutils";
import { ProxyHelper } from "./utils/proxy_helper";
import { PluginManager } from "../../../../common/lib";
import { TestDriver } from "./utils/test_driver";
import { DatabaseEngineDeployment } from "./utils/database_engine_deployment";

let itIf =
  features.includes(TestEnvironmentFeatures.FAILOVER_SUPPORTED) &&
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 3
    ? it
    : it.skip;

const endpointId1 = `test-endpoint-1-${randomUUID()}`;
const endpointId2 = `test-endpoint-2-${randomUUID()}`;
let endpointId3: string;
let endpointInfo1: DBClusterEndpoint;
let endpointInfo2: DBClusterEndpoint;
let endpointInfo3: DBClusterEndpoint;
let instance1: string;
let instance2: string;

let env: TestEnvironment;
let driver: TestDriver;
let client: any;
let rdsClient: RDSClient;
let initClientFunc: (props: any) => any;
let currentWriter: string;

let auroraTestUtility: AuroraTestUtility;

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean, failoverMode: string, usingFailover1: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    plugins: "customEndpoint,readWriteSplitting,failover",
    failoverTimeoutMs: 250000,
    failoverMode: failoverMode,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP"
  };
  if (usingFailover1) {
    config["plugins"] = "customEndpoint,readWriteSplitting,failover";
  } else {
    config["plugins"] = "customEndpoint,readWriteSplitting,failover2";
  }
  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function createEndpoint(clusterId: string, instances: TestInstanceInfo[], endpointId: string, endpointType: string) {
  const instanceIds = instances.map((instance: TestInstanceInfo) => instance.instanceId);
  const input = {
    DBClusterEndpointIdentifier: endpointId,
    DBClusterIdentifier: clusterId,
    EndpointType: endpointType,
    StaticMembers: instanceIds
  };
  const createEndpointCommand = new CreateDBClusterEndpointCommand(input);
  await rdsClient.send(createEndpointCommand);
}

async function waitUntilEndpointAvailable(endpointId: string): Promise<DBClusterEndpoint> {
  const timeoutEndMs = Date.now() + 300000; // 5 minutes
  let available = false;

  while (Date.now() < timeoutEndMs) {
    const input = {
      DBClusterEndpointIdentifier: endpointId,
      Filters: [
        {
          Name: "db-cluster-endpoint-type",
          Values: ["custom"]
        }
      ]
    };
    const command = new DescribeDBClusterEndpointsCommand(input);
    const result = await rdsClient.send(command);
    const endpoints = result.DBClusterEndpoints;
    if (endpoints.length !== 1) {
      // Endpoint needs more time to get created
      await sleep(3000);
    }

    const responseEndpoint = endpoints[0];
    const endpointInfo = responseEndpoint;

    available = responseEndpoint.Status === "available";
    if (available) {
      return endpointInfo;
    }

    await sleep(3000);
  }

  if (!available) {
    throw Error(`The test setup step timed out while waiting for the custom endpoint to become available: '${endpointId}'.`);
  }
}

async function waitUntilEndpointHasMembers(endpointId: string, membersList: string[]): Promise<void> {
  const start = Date.now();

  const timeoutEndMs = Date.now() + 1200000; // 20 minutes
  let hasCorrectState = false;
  while (Date.now() < timeoutEndMs) {
    const input = {
      DBClusterEndpointIdentifier: endpointId
    };
    const command = new DescribeDBClusterEndpointsCommand(input);
    const result = await rdsClient.send(command);
    const endpoints = result.DBClusterEndpoints;
    if (endpoints.length !== 1) {
      fail(
        `Unexpected number of endpoints returned while waiting for custom endpoint to have the specified list of members. Expected 1, got ${endpoints.length}.`
      );
    }

    const endpoint = endpoints[0];
    membersList.sort();
    endpoint.StaticMembers.sort();
    hasCorrectState = endpoint.Status === "available" && arraysAreEqual(membersList, endpoint.StaticMembers);
    if (hasCorrectState) {
      break;
    }

    await sleep(3000);
  }

  if (!hasCorrectState) {
    fail(`Timed out while waiting for the custom endpoint to stabilize: '${endpointId}'.`);
  }

  logger.info(`waitUntilEndpointHasMembers took ${(Date.now() - start) / 1000} seconds`);
}

function arraysAreEqual(array1: any[], array2: any[]): boolean {
  if (array1.length !== array2.length) {
    return false;
  }

  array1.sort();
  array2.sort();

  for (let i = 0; i < array1.length; i++) {
    if (array1[i] !== array2[i]) {
      return false;
    }
  }

  return true;
}

async function deleteEndpoint(rdsClient: RDSClient, endpointId: string): Promise<void> {
  const input = {
    DBClusterEndpointIdentifier: endpointId
  };
  const deleteEndpointCommand = new DeleteDBClusterEndpointCommand(input);
  try {
    await rdsClient.send(deleteEndpointCommand);
  } catch (e: any) {
    // Custom endpoint already does not exist - do nothing.
  }
}

describe("custom endpoint", () => {
  beforeAll(async () => {
    env = await TestEnvironment.getCurrent();
    // Custom endpoint is not compatible with multi-az clusters
    if (env.info.request.deployment === DatabaseEngineDeployment.RDS_MULTI_AZ_CLUSTER) {
      itIf = it.skip;
      return;
    }
    const clusterId = env.auroraClusterName;
    const region = env.region;
    rdsClient = new RDSClient({ region: region });

    auroraTestUtility = new AuroraTestUtility(env.region);
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();

    await TestEnvironment.verifyClusterStatus();
    const instances = env.databaseInfo.instances;
    instance1 = instances[0].instanceId;
    instance2 = instances[1].instanceId;
    await createEndpoint(clusterId, instances.slice(0, 1), endpointId1, "ANY");
    await createEndpoint(clusterId, instances.slice(0, 2), endpointId2, "ANY");
    endpointInfo1 = await waitUntilEndpointAvailable(endpointId1);
    endpointInfo2 = await waitUntilEndpointAvailable(endpointId2);
  }, 1000000);

  afterAll(async () => {
    try {
      await deleteEndpoint(rdsClient, endpointId1);
      await deleteEndpoint(rdsClient, endpointId2);
    } finally {
      rdsClient.destroy();
    }
  });

  beforeEach(async () => {
    await TestEnvironment.verifyClusterStatus();
    currentWriter = await auroraTestUtility.getClusterWriterInstanceId(env.info.auroraClusterName);
    logger.info(`Test started: ${expect.getState().currentTestName}`);
  }, 1000000);

  afterEach(async () => {
    if (client !== null) {
      try {
        await client.end();
      } catch (error) {
        // pass
      }
    }

    await PluginManager.releaseResources();
  }, 1000000);

  itIf.each([true, false])(
    "test custom endpoint failover - strict reader",
    async (usingFailover1: boolean) => {
      endpointId3 = `test-endpoint-3-${randomUUID()}`;
      await createEndpoint(env.auroraClusterName, env.instances.slice(0, 2), endpointId3, "READER");
      endpointInfo3 = await waitUntilEndpointAvailable(endpointId3);

      const config = await initDefaultConfig(endpointInfo3.Endpoint, env.databaseInfo.instanceEndpointPort, false, "strict-reader", usingFailover1);
      client = initClientFunc(config);

      await client.connect();

      const endpointMembers = endpointInfo3.StaticMembers;
      const instanceId = await auroraTestUtility.queryInstanceId(client);
      expect(endpointMembers.includes(instanceId)).toBeTruthy();
      expect(instanceId).not.toBe(currentWriter);

      // Use failover API to break connection.
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged(
        currentWriter,
        env.info.auroraClusterName,
        instanceId === instance1 ? instance1 : instance2
      );

      await expect(auroraTestUtility.queryInstanceId(client)).rejects.toThrow(FailoverSuccessError);

      endpointInfo3 = await waitUntilEndpointAvailable(endpointId3);
      const newEndpointMembers = endpointInfo3.StaticMembers;

      const newInstanceId: string = await auroraTestUtility.queryInstanceId(client);
      expect(newEndpointMembers.includes(newInstanceId)).toBeTruthy();

      const newWriter = await auroraTestUtility.getClusterWriterInstanceId(env.info.auroraClusterName);
      expect(newInstanceId).not.toBe(newWriter);

      await deleteEndpoint(rdsClient, endpointId3);
    },
    1000000
  );

  itIf.each([true, false])(
    "test custom endpoint read write splitting with custom endpoint changes",
    async (usingFailover1: boolean) => {
      const config = await initDefaultConfig(
        endpointInfo1.Endpoint,
        env.databaseInfo.instanceEndpointPort,
        false,
        "reader-or-writer",
        usingFailover1
      );
      // This setting is not required for the test, but it allows us to also test re-creation of expired monitors since it
      // takes more than 30 seconds to modify the cluster endpoint (usually around 140s).
      config.customEndpointMonitorExpirationMs = 30000;
      client = initClientFunc(config);

      await client.connect();

      const endpointMembers = endpointInfo1.StaticMembers;
      const instanceId1 = await auroraTestUtility.queryInstanceId(client);
      expect(endpointMembers.includes(instanceId1)).toBeTruthy();

      // Attempt to switch to an instance of the opposite role. This should fail since the custom endpoint consists only
      // of the current host.
      const newReadOnlyValue = currentWriter === instanceId1;
      if (newReadOnlyValue) {
        // We are connected to the writer. Attempting to switch to the reader will not work but will intentionally not
        // throw an error. In this scenario we log a warning and purposefully stick with the writer.
        await client.setReadOnly(newReadOnlyValue);
        const newInstanceId = await auroraTestUtility.queryInstanceId(client);
        expect(newInstanceId).toBe(instanceId1);
      } else {
        // We are connected to the reader. Attempting to switch to the writer will throw an error.
        logger.info("Initial connection is to a reader. Attempting to switch to writer...");
        await expect(client.setReadOnly(newReadOnlyValue)).rejects.toThrow(AwsWrapperError);
      }

      let newMember: string;
      if (currentWriter === instanceId1) {
        newMember = env.databaseInfo.instances[1].instanceId;
      } else {
        newMember = currentWriter;
      }

      const modifyEndpointCommand = new ModifyDBClusterEndpointCommand({
        DBClusterEndpointIdentifier: endpointId1,
        StaticMembers: [instanceId1, newMember]
      });
      await rdsClient.send(modifyEndpointCommand);

      try {
        await waitUntilEndpointHasMembers(endpointId1, [instanceId1, newMember]);

        // We should now be able to switch to newMember.
        await client.setReadOnly(newReadOnlyValue);
        const instanceId2 = await auroraTestUtility.queryInstanceId(client);
        expect(instanceId2).toBe(newMember);

        // Switch back to original instance.
        await client.setReadOnly(!newReadOnlyValue);
      } finally {
        const modifyEndpointCommand = new ModifyDBClusterEndpointCommand({
          DBClusterEndpointIdentifier: endpointId1,
          StaticMembers: [instanceId1]
        });
        await rdsClient.send(modifyEndpointCommand);
        await waitUntilEndpointHasMembers(endpointId1, [instanceId1]);
      }

      // We should not be able to switch again because newMember was removed from the custom endpoint.
      if (newReadOnlyValue) {
        // We are connected to the writer. Attempting to switch to the reader will not work but will intentionally not
        // throw an error. In this scenario we log a warning and purposefully stick with the writer.
        await client.setReadOnly(newReadOnlyValue);
        const newInstanceId = await auroraTestUtility.queryInstanceId(client);
        expect(newInstanceId).toBe(instanceId1);
      } else {
        // We are connected to the reader. Attempting to switch to the writer will throw an error.
        await expect(client.setReadOnly(newReadOnlyValue)).rejects.toThrow(AwsWrapperError);
      }
    },
    1000000
  );

  itIf.each([true, false])(
    "test custom endpoint failover - strict writer",
    async (usingFailvoer1: boolean) => {
      const config = await initDefaultConfig(endpointInfo2.Endpoint, env.databaseInfo.instanceEndpointPort, false, "strict-writer", usingFailvoer1);
      client = initClientFunc(config);

      await client.connect();

      const endpointMembers = endpointInfo2.StaticMembers;
      const instanceId = await auroraTestUtility.queryInstanceId(client);
      expect(endpointMembers.includes(instanceId)).toBeTruthy();

      const connectedToWriter = instanceId === currentWriter;
      let nextWriter: string;
      if (connectedToWriter) {
        nextWriter = instanceId === instance1 ? instance2 : instance1;
      } else {
        nextWriter = instanceId === instance1 ? instance1 : instance2;
      }

      // Use failover API to break connection.
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged(currentWriter, env.info.auroraClusterName, nextWriter);

      await expect(auroraTestUtility.queryInstanceId(client)).rejects.toThrow(FailoverSuccessError);

      endpointInfo2 = await waitUntilEndpointAvailable(endpointId2);
      const newEndpointMembers = endpointInfo2.StaticMembers;

      const newInstanceId: string = await auroraTestUtility.queryInstanceId(client);
      expect(newEndpointMembers.includes(newInstanceId)).toBeTruthy();

      const newWriter = await auroraTestUtility.getClusterWriterInstanceId(env.info.auroraClusterName);
      expect(newInstanceId).toBe(newWriter);
    },
    1000000
  );

  itIf.each([true, false])(
    "test custom endpoint failover - reader or writer mode",
    async (usingFailover1: boolean) => {
      const config = await initDefaultConfig(
        endpointInfo1.Endpoint,
        env.databaseInfo.instanceEndpointPort,
        false,
        "reader-or-writer",
        usingFailover1
      );
      client = initClientFunc(config);

      await client.connect();

      const endpointMembers = endpointInfo1.StaticMembers;
      const instanceId = await auroraTestUtility.queryInstanceId(client);
      expect(endpointMembers.includes(instanceId)).toBeTruthy();

      // Use failover API to break connection.
      const connectedToWriter = instanceId === currentWriter;
      let nextWriter: string;
      if (connectedToWriter) {
        nextWriter = instanceId === instance1 ? instance2 : instance1;
      } else {
        nextWriter = instanceId === instance1 ? instance1 : instance2;
      }
      await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged(currentWriter, env.info.auroraClusterName, nextWriter);

      await expect(auroraTestUtility.queryInstanceId(client)).rejects.toThrow(FailoverSuccessError);

      endpointInfo1 = await waitUntilEndpointAvailable(endpointId1);
      const newEndpointMembers = endpointInfo1.StaticMembers;

      const newInstanceId: string = await auroraTestUtility.queryInstanceId(client);
      expect(newEndpointMembers.includes(newInstanceId)).toBeTruthy();
    },
    1000000
  );
});
