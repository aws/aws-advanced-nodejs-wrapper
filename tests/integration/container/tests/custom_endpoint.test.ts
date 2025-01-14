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

const itIf =
  features.includes(TestEnvironmentFeatures.FAILOVER_SUPPORTED) &&
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 3
    ? it
    : it.skip;

const endpointId = `test-endpoint-1-${randomUUID()}`;
let endpointInfo: DBClusterEndpoint;

let env: TestEnvironment;
let driver: TestDriver;
let client: any;
let rdsClient: RDSClient;
let initClientFunc: (props: any) => any;
let currentWriter: string;

let auroraTestUtility: AuroraTestUtility;

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    plugins: "customEndpoint,readWriteSplitting,failover",
    failoverTimeoutMs: 250000,
    failoverMode: "reader-or-writer",
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP"
  };
  if (connectToProxy) {
    config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  }
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

async function createEndpoint(clusterId: string, instances: TestInstanceInfo[]) {
  const instanceIds = instances.map((instance: TestInstanceInfo) => instance.instanceId);
  const input = {
    DBClusterEndpointIdentifier: endpointId,
    DBClusterIdentifier: clusterId,
    EndpointType: "ANY",
    StaticMembers: instanceIds
  };
  const createEndpointCommand = new CreateDBClusterEndpointCommand(input);
  await rdsClient.send(createEndpointCommand);
}

async function waitUntilEndpointAvailable(): Promise<void> {
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
    endpointInfo = responseEndpoint;

    available = responseEndpoint.Status === "available";
    if (available) {
      break;
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

async function deleteEndpoint(rdsClient: RDSClient): Promise<void> {
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

    env = await TestEnvironment.getCurrent();
    const clusterId = env.auroraClusterName;
    const region = env.region;
    rdsClient = new RDSClient({ region: region });

    const instances = env.databaseInfo.instances;
    await createEndpoint(clusterId, instances.slice(0, 1));
    await waitUntilEndpointAvailable();
  }, 1000000);

  afterAll(async () => {
    try {
      await deleteEndpoint(rdsClient);
    } finally {
      rdsClient.destroy();
    }
  });

  beforeEach(async () => {
    auroraTestUtility = new AuroraTestUtility(env.region);
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    await TestEnvironment.verifyClusterStatus();
    currentWriter = await auroraTestUtility.getClusterWriterInstanceId(env.info.auroraClusterName);
  });

  afterEach(async () => {
    if (client !== null) {
      try {
        await client.end();
      } catch (error) {
        // pass
      }
    }

    await PluginManager.releaseResources();
  });

  itIf(
    "test custom endpoint failover",
    async () => {
      const config = await initDefaultConfig(endpointInfo.Endpoint, env.databaseInfo.instanceEndpointPort, false);
      client = initClientFunc(config);

      await client.connect();

      const endpointMembers = endpointInfo.StaticMembers;
      const instanceId = await auroraTestUtility.queryInstanceId(client);
      expect(endpointMembers.includes(instanceId)).toBeTruthy();

      // Use failover API to break connection.
      if (instanceId === currentWriter) {
        await auroraTestUtility.failoverClusterAndWaitUntilWriterChanged(instanceId);
      } else {
        await auroraTestUtility.failoverClusterToATargetAndWaitUntilWriterChanged(env.info.auroraClusterName, currentWriter, instanceId);
      }

      await expect(auroraTestUtility.queryInstanceId(client)).rejects.toThrow(FailoverSuccessError);

      await waitUntilEndpointAvailable();
      const newEndpointMembers = endpointInfo.StaticMembers;

      const newInstanceId: string = await auroraTestUtility.queryInstanceId(client);
      expect(newEndpointMembers.includes(newInstanceId)).toBeTruthy();
    },
    1000000
  );

  itIf(
    "test custom endpoint read write splitting with custom endpoint changes",
    async () => {
      const config = await initDefaultConfig(endpointInfo.Endpoint, env.databaseInfo.instanceEndpointPort, false);
      // This setting is not required for the test, but it allows us to also test re-creation of expired monitors since it
      // takes more than 30 seconds to modify the cluster endpoint (usually around 140s).
      config.customEndpointMonitorExpirationMs = 30000;
      client = initClientFunc(config);

      await client.connect();

      const endpointMembers = endpointInfo.StaticMembers;
      const instanceId1 = await auroraTestUtility.queryInstanceId(client);
      expect(endpointMembers.includes(instanceId1)).toBeTruthy();

      // Attempt to switch to an instance of the opposite role. This should fail since the custom endpoint consists only
      // of the current host.
      const newReadOnlyValue = currentWriter === instanceId1;
      if (newReadOnlyValue) {
        // We are connected to the writer. Attempting to switch to the reader will not work but will intentionally not
        // throw an exception. In this scenario we log a warning and purposefully stick with the writer.
        logger.info("Initial connection is to the writer. Attempting to switch to reader...");
        await client.setReadOnly(newReadOnlyValue);
        const newInstanceId = await auroraTestUtility.queryInstanceId(client);
        expect(newInstanceId).toBe(instanceId1);
      } else {
        // We are connected to the reader. Attempting to switch to the writer will throw an exception.
        logger.info("Initial connection is to a reader. Attempting to switch to writer...");
        await expect(await client.setReadOnly(newReadOnlyValue)).rejects.toThrow(AwsWrapperError);
      }

      let newMember: string;
      if (currentWriter === instanceId1) {
        newMember = env.databaseInfo.instances[1].instanceId;
      } else {
        newMember = currentWriter;
      }

      const modifyEndpointCommand = new ModifyDBClusterEndpointCommand({
        DBClusterEndpointIdentifier: endpointId,
        StaticMembers: [instanceId1, newMember]
      });
      await rdsClient.send(modifyEndpointCommand);

      try {
        await waitUntilEndpointHasMembers(endpointId, [instanceId1, newMember]);

        // We should now be able to switch to newMember.
        await client.setReadOnly(newReadOnlyValue);
        const instanceId2 = await auroraTestUtility.queryInstanceId(client);
        expect(instanceId2).toBe(newMember);

        // Switch back to original instance.
        await client.setReadOnly(!newReadOnlyValue);
      } finally {
        const modifyEndpointCommand = new ModifyDBClusterEndpointCommand({
          DBClusterEndpointIdentifier: endpointId,
          StaticMembers: [instanceId1]
        });
        await rdsClient.send(modifyEndpointCommand);
        await waitUntilEndpointHasMembers(endpointId, [instanceId1]);
      }

      // We should not be able to switch again because newMember was removed from the custom endpoint.
      if (newReadOnlyValue) {
        // We are connected to the writer. Attempting to switch to the reader will not work but will intentionally not
        // throw an exception. In this scenario we log a warning and purposefully stick with the writer.
        await client.setReadOnly(newReadOnlyValue);
        const newInstanceId = await auroraTestUtility.queryInstanceId(client);
        expect(newInstanceId).toBe(instanceId1);
      } else {
        // We are connected to the reader. Attempting to switch to the writer will throw an exception.
        await expect(await client.setReadOnly(newReadOnlyValue)).rejects.toThrow(AwsWrapperError);
      }
    },
    1000000
  );
});
