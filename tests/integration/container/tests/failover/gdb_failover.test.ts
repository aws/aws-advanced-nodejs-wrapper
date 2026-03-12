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

import { TestEnvironment } from "../utils/test_environment";
import { DriverHelper } from "../utils/driver_helper";
import { AuroraTestUtility } from "../utils/aurora_test_utility";
import { FailoverSuccessError, PluginManager } from "../../../../../index";
import { ProxyHelper } from "../utils/proxy_helper";
import { logger } from "../../../../../common/logutils";
import { features, instanceCount } from "../config";
import { TestEnvironmentFeatures } from "../utils/test_environment_features";
import { createFailoverTests } from "./failover_tests";

const itIf =
  features.includes(TestEnvironmentFeatures.FAILOVER_SUPPORTED) &&
  !features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY) &&
  instanceCount >= 2
    ? it
    : it.skip;
const itIfNetworkOutages = features.includes(TestEnvironmentFeatures.NETWORK_OUTAGES_ENABLED) && instanceCount >= 2 ? itIf : it.skip;

let env: TestEnvironment;
let driver: any;
let client: any;
let initClientFunc: (props: any) => any;

let auroraTestUtility: AuroraTestUtility;

async function initDefaultConfig(host: string, port: number, connectToProxy: boolean): Promise<any> {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    plugins: "gdbFailover",
    failoverTimeoutMs: 250000,
    activeHomeFailoverMode: "strict-writer",
    inactiveHomeFailoverMode: "strict-writer",
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

describe("gdb failover", () => {
  // Inherit failover failover tests with GDB-specific configuration
  // This mirrors the Java pattern where GdbFailoverTest extends FailoverTest
  describe(
    "failover tests",
    createFailoverTests({
      plugins: "gdbFailover",
      getExtraConfig: () => ({
        // These settings mimic failover/failover2 plugin logic when connecting to non-GDB Aurora or RDS DB clusters.
        activeHomeFailoverMode: "strict-writer",
        inactiveHomeFailoverMode: "strict-writer"
      })
    })
  );

  // GDB-specific tests (overrides from Java GdbFailoverTest)
  describe("gdb-specific tests", () => {
    beforeEach(async () => {
      logger.info(`Test started: ${expect.getState().currentTestName}`);
      env = await TestEnvironment.getCurrent();

      auroraTestUtility = new AuroraTestUtility(env.region);
      driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
      initClientFunc = DriverHelper.getClient(driver);
      await ProxyHelper.enableAllConnectivity();
      await TestEnvironment.verifyClusterStatus();

      client = null;
    }, 1320000);

    afterEach(async () => {
      if (client !== null) {
        try {
          await client.end();
        } catch (error) {
          // pass
        }
      }
      await PluginManager.releaseResources();
      logger.info(`Test finished: ${expect.getState().currentTestName}`);
    }, 1320000);

    it.only(
      "reader failover with home-reader-or-writer mode",
      async () => {
        const initialWriterId = env.proxyDatabaseInfo.writerInstanceId;
        const initialWriterHost = env.proxyDatabaseInfo.writerInstanceEndpoint;
        const initialWriterPort = env.proxyDatabaseInfo.instanceEndpointPort;

        const config = await initDefaultConfig(initialWriterHost, initialWriterPort, true);
        config["activeHomeFailoverMode"] = "home-reader-or-writer";
        config["inactiveHomeFailoverMode"] = "home-reader-or-writer";

        client = initClientFunc(config);
        await client.connect();

        await ProxyHelper.disableConnectivity(env.engine, initialWriterId!);

        await expect(async () => {
          await auroraTestUtility.queryInstanceId(client);
        }).rejects.toThrow(FailoverSuccessError);
      },
      1320000
    );

    itIfNetworkOutages(
      "reader failover with strict-home-reader mode",
      async () => {
        const initialWriterId = env.proxyDatabaseInfo.writerInstanceId;
        const initialWriterHost = env.proxyDatabaseInfo.writerInstanceEndpoint;
        const initialWriterPort = env.proxyDatabaseInfo.instanceEndpointPort;

        const config = await initDefaultConfig(initialWriterHost, initialWriterPort, true);
        config["activeHomeFailoverMode"] = "strict-home-reader";
        config["inactiveHomeFailoverMode"] = "strict-home-reader";

        client = initClientFunc(config);
        await client.connect();

        await ProxyHelper.disableConnectivity(env.engine, initialWriterId!);

        await expect(async () => {
          await auroraTestUtility.queryInstanceId(client);
        }).rejects.toThrow(FailoverSuccessError);

        const currentConnectionId = await auroraTestUtility.queryInstanceId(client);
        expect(await auroraTestUtility.isDbInstanceWriter(currentConnectionId)).toBe(false);
      },
      1320000
    );

    itIfNetworkOutages(
      "writer reelected with home-reader-or-writer mode",
      async () => {
        const initialWriterId = env.proxyDatabaseInfo.writerInstanceId;
        const initialWriterHost = env.proxyDatabaseInfo.writerInstanceEndpoint;
        const initialWriterPort = env.proxyDatabaseInfo.instanceEndpointPort;

        const config = await initDefaultConfig(initialWriterHost, initialWriterPort, true);
        config["activeHomeFailoverMode"] = "home-reader-or-writer";
        config["inactiveHomeFailoverMode"] = "home-reader-or-writer";

        client = initClientFunc(config);
        await client.connect();

        // Failover usually changes the writer instance, but we want to test re-election of the same writer, so we will
        // simulate this by temporarily disabling connectivity to the writer.
        await auroraTestUtility.simulateTemporaryFailure(initialWriterId!);

        await expect(async () => {
          await auroraTestUtility.queryInstanceId(client);
        }).rejects.toThrow(FailoverSuccessError);
      },
      1320000
    );
  });
});
