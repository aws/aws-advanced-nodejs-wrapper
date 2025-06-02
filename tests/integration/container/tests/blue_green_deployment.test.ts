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

import { features } from "./config";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { AuroraTestUtility } from "./utils/aurora_test_utility";
import { TestEnvironment } from "./utils/test_environment";
import { logger } from "../../../../common/logutils";
import { DriverHelper } from "./utils/driver_helper";
import { ProxyHelper } from "./utils/proxy_helper";
import { PluginManager } from "../../../../common/lib";
import { TestInstanceInfo } from "./utils/test_instance_info";
import { TestDatabaseInfo } from "./utils/test_database_info";
import { RdsUtils } from "../../../../common/lib/utils/rds_utils";
import { BlueGreenDeployment, DBCluster } from "@aws-sdk/client-rds";
import { DatabaseEngineDeployment } from "./utils/database_engine_deployment";
import { DBInstance } from "@aws-sdk/client-rds/dist-types/models/models_0";
import { DatabaseEngine } from "./utils/database_engine";
import { getTimeInNanos, sleep } from "../../../../common/lib/utils/utils";
import { BlueGreenRole } from "../../../../common/lib/plugins/bluegreen/blue_green_role";
import { AwsClient } from "../../../../common/lib/aws_client";
import { DatabaseDialectCodes } from "../../../../common/lib/database_dialect/database_dialect_codes";
import { promisify } from "util";
import { lookup } from "dns";
import AsciiTable from "ascii-table";
import { TestEnvironmentRequest } from "./utils/test_environment_request";
import { Signer } from "@aws-sdk/rds-signer";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { BlueGreenPlugin } from "../../../../common/lib/plugins/bluegreen/blue_green_plugin";

const itIf = features.includes(TestEnvironmentFeatures.BLUE_GREEN_DEPLOYMENT) ? it : it.skip;

const INCLUDE_CLUSTER_ENDPOINTS = false;
const INCLUDE_WRITER_AND_READER_ONLY = false;
const VERSION = process.env.npm_package_version;
const rdsUtil = new RdsUtils();
let auroraUtil = new AuroraTestUtility();

const MYSQL_BG_STATUS_QUERY =
  "SELECT id, SUBSTRING_INDEX(endpoint, '.', 1) as hostId, endpoint, port, role, status, version" + " FROM mysql.rds_topology";

const PG_AURORA_BG_STATUS_QUERY =
  "SELECT id, SPLIT_PART(endpoint, '.', 1) as hostId, endpoint, port, role, status, version" +
  " FROM get_blue_green_fast_switchover_metadata('aws_advanced_nodejs_wrapper')";

const PG_RDS_BG_STATUS_QUERY = `SELECT *
                                FROM rds_tools.show_topology('aws_advanced_nodejs_wrapper-${VERSION}')`;

const TEST_CLUSTER_ID = "test-cluster-id";

let env: TestEnvironment;
let request: TestEnvironmentRequest;
let info: TestDatabaseInfo;
let instances: TestInstanceInfo[];
let driver;
let client: any;
let secondaryClient: any;
let initClientFunc: (props: any) => any;

const results: Map<string, BlueGreenResults> = new Map();
let unhandledErrors: Error[] = [];

class AtomicBoolean {
  private value: boolean;

  constructor(initialValue: boolean = false) {
    this.value = initialValue;
  }

  get(): boolean {
    return this.value;
  }

  set(value: boolean): void {
    this.value = value;
  }
}

class TimeHolder {
  startTime: bigint;
  endTime: bigint;
  error: string;
  holdNano: bigint;

  constructor(startTime: bigint, endTime: bigint, holdNano?: bigint, error?: string) {
    this.startTime = startTime;
    this.endTime = endTime;
    this.error = error;
    this.holdNano = holdNano;
  }
}

class QueryResult {
  queryRole: string;
  queryVersion: string;
  queryNewStatus: string;

  constructor(queryRole: string, queryVersion: string, queryNewStatus: string) {
    this.queryRole = queryRole;
    this.queryVersion = queryVersion;
    this.queryNewStatus = queryNewStatus;
  }
}

class BlueGreenResults {
  startTime: bigint;
  promiseSyncTime: bigint;
  bgTriggerTime: bigint;
  directBlueLostConnectionTime: bigint;
  directBlueIdleLostConnectionTime: bigint;
  wrapperBlueIdleLostConnectionTime: bigint;
  wrapperGreenLostConnectionTime: bigint;
  dnsBlueChangedTime: bigint;
  dnsBlueError: string = null;
  dnsGreenRemovedTime: bigint;
  greenHostChangeNameTime: bigint;
  blueStatusTime: Map<string, bigint> = new Map();
  greenStatusTime: Map<string, bigint> = new Map();
  blueWrapperConnectTimes: TimeHolder[] = [];
  blueWrapperExecuteTimes: TimeHolder[] = [];
  greenWrapperExecuteTimes: TimeHolder[] = [];
  greenDirectIamIpWithBlueHostConnectTimes: TimeHolder[] = [];
  greenDirectIamIpWithGreenHostConnectTimes: TimeHolder[] = [];
}

async function getBlueGreenEndpoints(blueGreenId: string): Promise<string[]> {
  const blueGreenDeployment: BlueGreenDeployment | null = await auroraUtil.getBlueGreenDeployment(blueGreenId);
  if (blueGreenDeployment === null) {
    throw new Error(`BG not found: ` + blueGreenId);
  }
  switch (request.deployment) {
    case DatabaseEngineDeployment.RDS_MULTI_AZ_INSTANCE: {
      const blueInstance: DBInstance = await auroraUtil.getRdsInstanceInfoByArn(blueGreenDeployment.Source);
      if (blueInstance === undefined) {
        throw new Error("Blue instance not found.");
      }
      const greenInstance: DBInstance = await auroraUtil.getRdsInstanceInfoByArn(blueGreenDeployment.Target);
      if (greenInstance === undefined) {
        throw new Error("Green instance not found.");
      }

      return [blueInstance.Endpoint.Address, greenInstance.Endpoint.Address];
    }
    case DatabaseEngineDeployment.AURORA: {
      const endpoints: string[] = [];
      const blueCluster: DBCluster = await auroraUtil.getClusterByArn(blueGreenDeployment.Source);
      if (blueCluster === undefined) {
        throw new Error("Blue cluster not found.");
      }

      if (INCLUDE_CLUSTER_ENDPOINTS) {
        endpoints.push(info.clusterEndpoint);
      }

      if (INCLUDE_WRITER_AND_READER_ONLY) {
        endpoints.push(instances[0].host);
        if (instances.length > 1) {
          endpoints.push(instances[1].host);
        }
      } else {
        instances.forEach((info) => endpoints.push(info.host));
      }

      const greenCluster: DBCluster = await auroraUtil.getClusterByArn(blueGreenDeployment.Target);
      if (greenCluster === undefined) {
        throw new Error("Green cluster not found.");
      }

      if (INCLUDE_CLUSTER_ENDPOINTS) {
        endpoints.push(greenCluster.Endpoint);
      }

      const instanceIdClient = await openConnectionWithRetry(initDefaultConfig(info.clusterEndpoint, info.clusterEndpointPort, info.defaultDbName));
      const instanceIds: string[] = await auroraUtil.getAuroraInstanceIds(request.engine, request.deployment, instanceIdClient);
      if (instanceIds.length < 1) {
        throw new Error("Can't find green cluster instances.");
      }

      const instancePattern: string = rdsUtil.getRdsInstanceHostPattern(greenCluster.Endpoint);
      if (INCLUDE_WRITER_AND_READER_ONLY) {
        endpoints.push(instancePattern.replace("?", instanceIds[0]));
        if (instanceIds.length > 1) {
          endpoints.push(instancePattern.replace("?", instanceIds[1]));
        }
      } else {
        instanceIds.forEach((instanceId) => endpoints.push(instancePattern.replace("?", instanceId)));
      }

      return endpoints;
    }
  }
}

function initDefaultConfig(host: string, port: number, dbName: string) {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: dbName,
    password: env.databaseInfo.password,
    port: port,
    enableTelemetry: true,
    telemetryTracesBackend: "OTLP",
    telemetryMetricsBackend: "OTLP",
    plugins: ""
  };
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);
  return config;
}

function initWrapperConfig(host: string, port: number, dbName: string) {
  const config = initDefaultConfig(host, port, dbName);
  config["clusterId"] = TEST_CLUSTER_ID;

  const databaseEngine: DatabaseEngine = env.info.request.engine;
  switch (env.info.request.deployment) {
    case DatabaseEngineDeployment.AURORA:
      switch (databaseEngine) {
        case DatabaseEngine.MYSQL:
          config["dialect"] = DatabaseDialectCodes.AURORA_MYSQL;
          break;
        case DatabaseEngine.PG:
          config["dialect"] = DatabaseDialectCodes.AURORA_PG;
          break;
        default:
        // do nothing
      }
      break;
    case DatabaseEngineDeployment.RDS_MULTI_AZ_INSTANCE:
      switch (databaseEngine) {
        case DatabaseEngine.MYSQL:
          config["dialect"] = DatabaseDialectCodes.RDS_MYSQL;
          break;
        case DatabaseEngine.PG:
          config["dialect"] = DatabaseDialectCodes.RDS_PG;
          break;
        default:
        // do nothing
      }
      break;
    default:
    // do nothing
  }

  if (env.info.request.features.includes(TestEnvironmentFeatures.IAM)) {
    config["iamRegion"] = env.region;
    config["user"] = env.info.iamUserName;
    config["plugins"] = "bg,iam";
  } else {
    config["plugins"] = "bg";
  }
  return config;
}

function processResult(result: any): QueryResult[] {
  const results: QueryResult[] = [];
  switch (env.info.request.engine) {
    case DatabaseEngine.MYSQL:
      for (const row of result[0]) {
        results.push(new QueryResult(row.role, row.version, row.status));
      }
      break;
    case DatabaseEngine.PG:
      for (const row of result.rows) {
        results.push(new QueryResult(row.role, row.version, row.status));
      }
      break;
    default:
      throw new Error(`Unsupported engine type: ${env.info.request.engine}`);
  }

  return results;
}

describe("blue green", () => {
  beforeEach(async () => {
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    request = env.info.request;
    info = env.info.databaseInfo;
    instances = info.instances;
    auroraUtil = new AuroraTestUtility(env.region, env.rdsEndpoint);
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    await ProxyHelper.enableAllConnectivity();
    await TestEnvironment.verifyClusterStatus(auroraUtil);

    client = null;
    secondaryClient = null;
  });

  afterEach(async () => {
    if (client !== null) {
      try {
        await client.end();
      } catch (error) {
        // pass
      }
    }

    if (secondaryClient !== null) {
      try {
        await secondaryClient.end();
      } catch (error) {
        // pass
      }
    }
    await PluginManager.releaseResources();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  });

  itIf("switchover", async () => {
    results.clear();
    unhandledErrors = [];

    const iamEnabled: boolean = env.info.request.features.includes(TestEnvironmentFeatures.IAM);

    const startTimeNano: bigint = process.hrtime.bigint();

    const stop = new AtomicBoolean(false);
    const promises: Promise<void>[] = [];
    let promiseCount: number = 0;
    let promiseFinishCount: number = 0;

    const instance: TestInstanceInfo = instances[0];
    const dbName: string = info.defaultDbName;

    const topologyInstances: string[] = await getBlueGreenEndpoints(info.blueGreenDeploymentId);
    logger.debug(`topologyInstances: \n${topologyInstances.join("\n")}`);

    for (const host of topologyInstances) {
      const hostId: string = host.split(".")[0];
      results.set(hostId, new BlueGreenResults());

      if (rdsUtil.isNotGreenAndOldPrefixInstance(host)) {
        // Direct topology monitoring
        promises.push(getDirectTopologyMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        // Direct blue connectivity monitoring
        promises.push(getDirectBlueConnectivityMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        // Direct blue idle connectivity monitoring
        promises.push(getDirectBlueIdleConnectivityMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        // Wrapper blue idle connectivity monitoring
        promises.push(getWrapperBlueIdleConnectivityMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        // Wrapper blue executing connectivity monitoring
        promises.push(getWrapperBlueExecutingConnectivityMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        // Wrapper blue new connection monitoring
        promises.push(getWrapperBlueNewConnectionMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;

        // Blue DNS monitoring
        promises.push(getBlueDnsMonitoringPromise(hostId, host, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;
      }

      if (rdsUtil.isGreenInstance(host)) {
        // Direct topology monitoring
        promises.push(getDirectTopologyMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        // Wrapper green connectivity monitoring
        promises.push(getWrapperGreenConnectivityMonitoringPromise(hostId, host, instance.port, dbName, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        // Green DNS monitoring
        promises.push(getGreenDnsMonitoringPromise(hostId, host, stop, results.get(hostId)));
        promiseCount++;
        promiseFinishCount++;

        if (iamEnabled) {
          promises.push(
            getGreenIamConnectivityMonitoringPromise(
              hostId,
              "BlueHostToken",
              rdsUtil.removeGreenInstancePrefix(host),
              host,
              instance.port,
              dbName,
              stop,
              results.get(hostId),
              results.get(hostId).greenDirectIamIpWithBlueHostConnectTimes,
              false,
              true
            )
          );

          promiseCount++;
          promiseFinishCount++;

          promises.push(
            getGreenIamConnectivityMonitoringPromise(
              hostId,
              "GreenHostToken",
              host,
              host,
              instance.port,
              dbName,
              stop,
              results.get(hostId),
              results.get(hostId).greenDirectIamIpWithGreenHostConnectTimes,
              true,
              false
            )
          );

          promiseCount++;
          promiseFinishCount++;
        }
      }
    }

    promises.push(getBlueGreenSwitchoverTriggerPromise(info.blueGreenDeploymentId, results));
    promiseCount++;
    promiseFinishCount++;

    results.forEach((value, key) => (value.startTime = startTimeNano));

    await sleep(1_200_000);

    logger.debug(`Stopping all promises`);
    stop.set(true);
    await sleep(5000);
    printMetrics();

    if (unhandledErrors.length > 0) {
      logUnhandledErrors();
      fail("There are unhandled errors.");
    }
  });
});

async function getDirectTopologyMonitoringPromise(
  hostId: string,
  host: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults
) {
  let query: string;
  switch (env.info.request.engine) {
    case DatabaseEngine.MYSQL:
      query = MYSQL_BG_STATUS_QUERY;
      break;
    case DatabaseEngine.PG:
      switch (env.info.request.deployment) {
        case DatabaseEngineDeployment.AURORA:
          query = PG_AURORA_BG_STATUS_QUERY;
          break;
        case DatabaseEngineDeployment.RDS_MULTI_AZ_INSTANCE:
          query = PG_RDS_BG_STATUS_QUERY;
          break;
        default:
          throw new Error(`Unsupported deployment ${env.info.request.deployment}`);
      }
      break;
    default:
      throw new Error(`Unsupported engine ${env.info.request.engine}`);
  }
  const dbConfig = await initDefaultConfig(host, port, dbName);

  try {
    client = await openConnectionWithRetry(dbConfig);

    logger.debug(`[DirectTopology @ ${hostId}] connection opened.`);

    await sleep(1000);

    logger.debug(`[DirectTopology @ ${hostId}] Starting BG statuses monitoring.`);

    const endTime: bigint = process.hrtime.bigint() + BigInt(900_000_000_000); // 15 minutes

    while (!stop.get() && process.hrtime.bigint() < endTime) {
      try {
        if (client == null) {
          client = await openConnectionWithRetry(dbConfig);
          logger.debug(`[DirectTopology @ ${hostId} connection re-opened.`);
        }

        const res = await client.query(query);
        const queryResults: QueryResult[] = processResult(res);

        for (const queryResult of queryResults) {
          const newStatus: string = queryResult.queryNewStatus;

          const isGreen: boolean = BlueGreenRole.parseRole(queryResult.queryRole, queryResult.queryVersion) === BlueGreenRole.TARGET;

          if (isGreen) {
            const hasStatus = results.greenStatusTime.has(newStatus);
            if (!hasStatus) {
              logger.debug(`[DirectTopology @ ${hostId} status changed to: ${newStatus}`);
              results.greenStatusTime.set(newStatus, process.hrtime.bigint());
            }
          } else {
            const hasStatus = results.blueStatusTime.has(newStatus);
            if (!hasStatus) {
              logger.debug(`[DirectTopology @ ${hostId} status changed to: ${newStatus}`);
              results.blueStatusTime.set(newStatus, process.hrtime.bigint());
            }
          }
        }

        await sleep(100);
      } catch (e: any) {
        logger.debug(`[DirectTopology @ ${hostId} error: ${e.message}`);
        await closeConnection(client);
        client = null;
      }
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[DirectTopology @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[DirectTopology @ ${hostId}] promise is completed.`);
  }
}

async function closeConnection(client: AwsClient) {
  try {
    if (client != null && !(await client.isValid())) {
      await client.end();
    }
  } catch (e: any) {
    // do nothing
  }
}

// Blue host
// Checking: connectivity, SELECT 1
async function getDirectBlueConnectivityMonitoringPromise(
  hostId: string,
  host: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults
) {
  const dbConfig = await initDefaultConfig(host, port, dbName);

  try {
    client = await openConnectionWithRetry(dbConfig);

    logger.debug(`[DirectBlueConnectivity @ ${hostId}] connection opened.`);

    await sleep(300_000);

    logger.debug(`[DirectBlueConnectivity @ ${hostId}] Starting connectivity monitoring.`);

    while (!stop) {
      try {
        await client.query("SELECT 1");
        await sleep(1000);
      } catch (e: any) {
        logger.debug(`[DirectBlueConnectivity @ ${hostId} error: ${e.message}`);
        results.directBlueLostConnectionTime = process.hrtime.bigint();
        break;
      }
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[DirectBlueConnectivity @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[DirectBlueConnectivity @ ${hostId}] promise is completed.`);
  }
}

// Blue host
// Check: connectivity, isClosed()
async function getDirectBlueIdleConnectivityMonitoringPromise(
  hostId: string,
  host: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults
) {
  const dbConfig = await initDefaultConfig(host, port, dbName);

  try {
    client = await openConnectionWithRetry(dbConfig);

    logger.debug(`[DirectBlueConnectivity @ ${hostId}] connection opened.`);

    await sleep(300_000);

    logger.debug(`[DirectBlueConnectivity @ ${hostId}] Starting connectivity monitoring.`);

    while (!stop.get()) {
      try {
        await client.query("SELECT 1");
        await sleep(1000);
      } catch (e: any) {
        logger.debug(`[DirectBlueConnectivity @ ${hostId} error: ${e.message}`);
        results.directBlueLostConnectionTime = process.hrtime.bigint();
        break;
      }
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[DirectBlueConnectivity @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[DirectBlueConnectivity @ ${hostId}] promise is completed.`);
  }
}

// Blue host
// Check: connectivity, isClosed()
async function getWrapperBlueIdleConnectivityMonitoringPromise(
  hostId: string,
  host: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults
) {
  const dbConfig = await initDefaultConfig(host, port, dbName);

  try {
    client = await openConnectionWithRetry(dbConfig);

    logger.debug(`[WrapperBlueIdle @ ${hostId}] connection opened.`);

    await sleep(300_000);

    logger.debug(`[WrapperBlueIdle @ ${hostId}] Starting connectivity monitoring.`);

    while (!stop.get()) {
      try {
        if (!(await client.isValid())) {
          results.wrapperBlueIdleLostConnectionTime = process.hrtime.bigint();
          break;
        }
        await sleep(1000);
      } catch (e: any) {
        logger.debug(`[WrapperBlueIdle @ ${hostId} error: ${e.message}`);
        results.wrapperBlueIdleLostConnectionTime = process.hrtime.bigint();
        break;
      }
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[WrapperBlueIdle @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[WrapperBlueIdle @ ${hostId}] promise is completed.`);
  }
}

// Blue host
// Check: connectivity, SELECT sleep(5)
// Expect: long execution time (longer than 5s) during active phase of switchover
async function getWrapperBlueExecutingConnectivityMonitoringPromise(
  hostId: string,
  host: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults
) {
  const dbConfig = await initWrapperConfig(host, port, dbName);
  let query;
  switch (env.info.request.engine) {
    case DatabaseEngine.PG:
      query = "SELECT PG_SLEEP(5)";
      break;
    case DatabaseEngine.MYSQL:
      query = "SELECT SLEEP(5)";
      break;
    default:
      throw new Error(`Unsupported database engine: ${env.info.request.engine}`);
  }

  try {
    client = initClientFunc(dbConfig);

    logger.debug(`[WrapperBlueExecute @ ${hostId}] connection opened.`);

    await sleep(300_000);

    logger.debug(`[WrapperBlueExecute @ ${hostId}] Starting connectivity monitoring.`);

    const bgPlugin: BlueGreenPlugin = client.unwrapPlugin(BlueGreenPlugin);

    while (!stop.get()) {
      const startTime = process.hrtime.bigint();
      let endTime: bigint;
      try {
        await client.query(query);
        endTime = process.hrtime.bigint();

        results.blueWrapperConnectTimes.push(new TimeHolder(startTime, endTime, bgPlugin.getHoldTimeNano()));
        logger.debug(`[WrapperBlueExecute @ ${hostId}] results: ${JSON.stringify(results)}.`);
      } catch (e: any) {
        endTime = process.hrtime.bigint();
        results.blueWrapperConnectTimes.push(new TimeHolder(startTime, endTime, bgPlugin.getHoldTimeNano(), e.message));
        if (!(await client.isValid())) {
          break;
        }
      }
      await sleep(1000);
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[WrapperBlueExecute @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[WrapperBlueExecute @ ${hostId}] promise is completed.`);
  }
}

// Blue host
// Check: connectivity, opening a new connection
// Expect: longer opening connection time during active phase of switchover
async function getWrapperBlueNewConnectionMonitoringPromise(
  hostId: string,
  host: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults
) {
  const dbConfig = await initWrapperConfig(host, port, dbName);
  try {
    await sleep(300_000);

    logger.debug(`[WrapperBlueNewConnection @ ${hostId}] Starting connectivity monitoring.`);

    const bgPlugin: BlueGreenPlugin = client.unwrapPlugin(BlueGreenPlugin);

    while (!stop.get()) {
      const startTime = process.hrtime.bigint();
      let endTime;
      try {
        client = await openConnectionWithRetry(dbConfig);
        endTime = process.hrtime.bigint();
        results.blueWrapperExecuteTimes.push(new TimeHolder(startTime, endTime, bgPlugin.getHoldTimeNano()));
      } catch (e: any) {
        endTime = process.hrtime.bigint();
        results.blueWrapperExecuteTimes.push(new TimeHolder(startTime, endTime, bgPlugin.getHoldTimeNano(), e.message));
        if (!(await client.isValid())) {
          break;
        }
      }
      await sleep(1000);
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[WrapperBlueNewConnection @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[WrapperBlueNewConnection @ ${hostId}] promise is completed.`);
  }
}

async function getBlueDnsMonitoringPromise(hostId: string, host: string, stop: AtomicBoolean, results: BlueGreenResults) {
  await sleep(300_000);

  try {
    const ip: string = (await promisify(lookup)(host, {})).address;
    logger.debug(`[BlueDNS @ ${hostId}] ${host} -> ${ip}`);

    while (!stop.get()) {
      await sleep(1000);
      try {
        const temp: string = (await promisify(lookup)(host, {})).address;
      } catch (e: any) {
        results.dnsGreenRemovedTime = process.hrtime.bigint();
        break;
      }
    }
  } catch (e: any) {
    logger.debug(`[BlueDNS @ ${hostId}] unhandled error: ${e.message}`);
    results.dnsGreenRemovedTime = process.hrtime.bigint();
  } finally {
    logger.debug(`[BlueDNS @ ${hostId}] promise is complete.`);
  }
}

async function getWrapperGreenConnectivityMonitoringPromise(
  hostId: string,
  host: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults
) {
  const dbConfig = await initWrapperConfig(host, port, dbName);

  let startTime;
  let endTime;

  try {
    client = await openConnectionWithRetry(dbConfig);

    await sleep(300_000);

    logger.debug(`[WrapperGreenConnectivity @ ${hostId}] Starting connectivity monitoring.`);

    const bgPlugin: BlueGreenPlugin = client.unwrapPlugin(BlueGreenPlugin);

    while (!stop.get()) {
      try {
        startTime = process.hrtime.bigint();
        await client.query("SELECT 1");
        endTime = process.hrtime.bigint();
        results.greenWrapperExecuteTimes.push(new TimeHolder(startTime, endTime, bgPlugin.getHoldTimeNano()));
        await sleep(1000);
      } catch (e: any) {
        results.greenWrapperExecuteTimes.push(new TimeHolder(startTime, endTime, bgPlugin.getHoldTimeNano(), e.message));
        if (!(await client.isValid())) {
          results.wrapperGreenLostConnectionTime = getTimeInNanos();
          break;
        }
        logger.debug(`[WrapperGreenConnectivity @ ${hostId} error: ${e.message}`);
        break;
      }
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[WrapperGreenConnectivity @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[WrapperGreenConnectivity @ ${hostId}] promise is completed.`);
  }
}

async function getGreenDnsMonitoringPromise(hostId: string, host: string, stop: AtomicBoolean, results: BlueGreenResults) {
  const ip: string = (await promisify(lookup)(host, {})).address;
  logger.debug(`[GreenDNS @ ${hostId}] ${host} -> ${ip}`);
  try {
    while (!stop.get()) {
      await sleep(1000);
      try {
        const temp: string = (await promisify(lookup)(host, {})).address;
      } catch (e: any) {
        results.dnsGreenRemovedTime = process.hrtime.bigint();
        break;
      }
    }
  } catch (e: any) {
    logger.debug(`[GreenDNS @ ${hostId}] unhandled error: ${e.message}`);
    results.dnsGreenRemovedTime = process.hrtime.bigint();
  } finally {
    logger.debug(`[GreenDNS @ ${hostId}] promise is complete.`);
  }
}

// Green host
// Check: connectivity (opening a new connection) with IAM when using host IP address
// Expect: lose connectivity after green host changes its name (green prefix to no-prefix)
async function getGreenIamConnectivityMonitoringPromise(
  hostId: string,
  prefix: string,
  iamTokenHost: string,
  connectHost: string,
  port: number,
  dbName: string,
  stop: AtomicBoolean,
  results: BlueGreenResults,
  timeHolders: TimeHolder[],
  notifyOnFirstError: boolean,
  exitOnFirstSuccess: boolean
) {
  await sleep(300_000);

  try {
    const greenHostConnectIp: string = (await promisify(lookup)(connectHost, {})).address;

    logger.debug(`[DirectGreenIamIp${prefix} @ ${hostId}] Starting connectivity monitoring ${iamTokenHost}.`);

    while (!stop) {
      const signer = new Signer({
        hostname: iamTokenHost,
        port: port,
        region: env.region,
        credentials: fromNodeProviderChain(),
        username: env.info.iamUserName
      });

      const token: string = await signer.getAuthToken();

      const startTime: bigint = process.hrtime.bigint();
      let endTime: bigint;
      logger.warn(`greenHostConnectIp: ${greenHostConnectIp}`);
      let config: any = {
        user: env.info.iamUserName,
        host: greenHostConnectIp,
        database: dbName,
        password: token,
        port: port,
        plugins: ""
      };
      config = DriverHelper.addDriverSpecificConfiguration(config, env.engine);

      try {
        await openConnectionWithRetry(config);
        endTime = process.hrtime.bigint();
        timeHolders.push(new TimeHolder(startTime, endTime));
        if (exitOnFirstSuccess) {
          if (results.greenHostChangeNameTime === BigInt(0)) {
            results.greenHostChangeNameTime = process.hrtime.bigint();
            logger.debug(`[DirectGreenIamIp${prefix} @ ${hostId}`);
            return;
          }
        }
      } catch (error: any) {
        logger.debug(`[DirectGreenIamIp${prefix} @ ${hostId}] error: ${error.message}`);
        endTime = process.hrtime.bigint();
        timeHolders.push(new TimeHolder(startTime, endTime));
        if (notifyOnFirstError && (error.message.contains("Access denied") || error.message.contains("PAM"))) {
          if (results.greenHostChangeNameTime === BigInt(0)) {
            results.greenHostChangeNameTime = process.hrtime.bigint();
          }
          logger.debug(`[DirectGreenIamIp${prefix} @ ${hostId}] The first login error. Exiting thread.`);
          return;
        }
      }

      await closeConnection(client);
      client = null;
      await sleep(1000);
    }
  } catch (e: any) {
    unhandledErrors.push(e);
    logger.debug(`[DirectGreenIamIp${prefix} @ ${hostId}] unhandled error: ${e.message}`);
  } finally {
    await closeConnection(client);
    logger.debug(`[DirectGreenIamIp${prefix} @ ${hostId}] promise is completed.`);
  }
}

async function getBlueGreenSwitchoverTriggerPromise(blueGreenId: string, results: Map<string, BlueGreenResults>) {
  await sleep(300_000);
  const threadsSyncTime: bigint = process.hrtime.bigint();
  results.forEach((value, key) => (value.promiseSyncTime = threadsSyncTime));
  await sleep(30000);

  await auroraUtil.switchoverBlueGreenDeployment(blueGreenId);
  const bgTriggerTime: bigint = process.hrtime.bigint();
  results.forEach((value, key) => {
    logger.warn(`bgTriggerTime: ${bgTriggerTime}`);
    value.bgTriggerTime = bgTriggerTime;
  });
}

async function openConnectionWithRetry(config: any) {
  const client = initClientFunc(config);
  let tries = 0;
  while (tries < 10) {
    try {
      await client.connect();
      return client;
    } catch (error: any) {
      // do nothing
      logger.error(error.message);
    }
    tries++;
  }
  throw new Error("Can't open connection");
}

function printMetrics(): void {
  const bgTriggerTime: bigint =
    Array.from(results.values())
      .map((blueGreenResults) => blueGreenResults.bgTriggerTime)
      .find(Boolean) ||
    (() => {
      throw new Error("Can't get bgTriggerTime");
    })();

  const metricsTable = new AsciiTable().setBorder("|", "-", "+", "+");

  metricsTable.setHeading(
    "Instance/endpoint",
    "startTime",
    "promisesSync",
    "direct Blue conn dropped (idle)",
    "direct Blue conn dropped (SELECT 1)",
    "wrapper Blue conn dropped (idle)",
    "wrapper Green conn dropped (SELECT 1)",
    "Blue DNS updated",
    "Green DNS removed",
    "Green host certificate change"
  );

  // Sort entries by green instance first, then by name
  const sortedEntries = Array.from(results.entries()).sort((a, b) => {
    // First sort by green/blue
    const greenCompare = (rdsUtil.isGreenInstance(a[0] + ".") ? 1 : 0) - (rdsUtil.isGreenInstance(b[0] + ".") ? 1 : 0);
    if (greenCompare !== 0) return greenCompare;

    // Then sort by name
    return rdsUtil.removeGreenInstancePrefix(a[0]).toLowerCase().localeCompare(rdsUtil.removeGreenInstancePrefix(b[0]).toLowerCase());
  });

  if (sortedEntries.length === 0) {
    metricsTable.addRow("No entries");
  }

  for (const [key, value] of sortedEntries) {
    const startTime = Number(value.startTime - bgTriggerTime) / 1000000;
    const promisesSyncTime = Number(value.promiseSyncTime - bgTriggerTime) / 1000000;
    const directBlueIdleLostConnectionTime = getFormattedNanoTime(value.directBlueIdleLostConnectionTime, bgTriggerTime);
    const directBlueLostConnectionTime = getFormattedNanoTime(value.directBlueLostConnectionTime, bgTriggerTime);
    const wrapperBlueIdleLostConnectionTime = getFormattedNanoTime(value.wrapperBlueIdleLostConnectionTime, bgTriggerTime);
    const wrapperGreenLostConnectionTime = getFormattedNanoTime(value.wrapperGreenLostConnectionTime, bgTriggerTime);
    const dnsBlueChangedTime = getFormattedNanoTime(value.dnsBlueChangedTime, bgTriggerTime);
    const dnsGreenRemovedTime = getFormattedNanoTime(value.dnsGreenRemovedTime, bgTriggerTime);
    const greenHostChangeNameTime = getFormattedNanoTime(value.greenHostChangeNameTime, bgTriggerTime);

    metricsTable.addRow(
      key,
      startTime,
      promisesSyncTime,
      directBlueIdleLostConnectionTime,
      directBlueLostConnectionTime,
      wrapperBlueIdleLostConnectionTime,
      wrapperGreenLostConnectionTime,
      dnsBlueChangedTime,
      dnsGreenRemovedTime,
      greenHostChangeNameTime
    );
  }

  logger.debug("\n" + renderTable(metricsTable, true));

  // Print host status times
  for (const [key, value] of sortedEntries) {
    if (value.blueStatusTime.size === 0 && value.greenStatusTime.size === 0) {
      continue;
    }
    printHostStatusTimes(key, value, bgTriggerTime);
  }

  // Print wrapper connection times to Blue
  for (const [key, value] of sortedEntries) {
    if (value.blueWrapperConnectTimes.length === 0) {
      continue;
    }
    printDurationTimes(key, "Wrapper connection time (ms) to Blue", value.blueWrapperConnectTimes, bgTriggerTime);
  }

  // Print wrapper IAM connection times to Green
  for (const [key, value] of sortedEntries) {
    if (value.greenDirectIamIpWithGreenHostConnectTimes.length === 0) {
      continue;
    }
    printDurationTimes(
      key,
      "Wrapper IAM (green token) connection time (ms) to Green",
      value.greenDirectIamIpWithGreenHostConnectTimes,
      bgTriggerTime
    );
  }

  // Print wrapper execution times to Blue
  for (const [key, value] of sortedEntries) {
    if (value.blueWrapperExecuteTimes.length === 0) {
      continue;
    }
    printDurationTimes(key, "Wrapper execution time (ms) to Blue", value.blueWrapperExecuteTimes, bgTriggerTime);
  }

  // Print wrapper execution times to Green
  for (const [key, value] of sortedEntries) {
    if (value.greenWrapperExecuteTimes.length === 0) {
      continue;
    }
    printDurationTimes(key, "Wrapper execution time (ms) to Green", value.greenWrapperExecuteTimes, bgTriggerTime);
  }
}

function getFormattedNanoTime(timeNano: bigint, timeZeroNano: bigint): string {
  return !timeNano ? "-" : `${Number(timeNano - timeZeroNano) / 1000000} ms`;
}

function printHostStatusTimes(host: string, results: BlueGreenResults, timeZeroNano: bigint): void {
  const statusMap = new Map<string, bigint>();

  // Combine blue and green status times
  results.blueStatusTime.forEach((value, key) => statusMap.set(key, value));
  results.greenStatusTime.forEach((value, key) => statusMap.set(key, value));

  const metricsTable = new AsciiTable().setBorder("|", "-", "+", "+");

  metricsTable.setHeading("Status", "SOURCE", "TARGET");

  // Sort status names by their values
  const sortedStatusNames = Array.from(statusMap.entries())
    .sort((a, b) => Number(a[1] - b[1]))
    .map((entry) => entry[0]);

  for (const status of sortedStatusNames) {
    const sourceTime = results.blueStatusTime.has(status) ? `${Number(results.blueStatusTime.get(status) - timeZeroNano) / 1000000} ms` : "";
    const targetTime = results.greenStatusTime.has(status) ? `${Number(results.greenStatusTime.get(status) - timeZeroNano) / 1000000} ms` : "";

    metricsTable.addRow(status, sourceTime, targetTime);
  }

  logger.debug(`\n${host}:\n${renderTable(metricsTable, true)}`);
}

function printDurationTimes(host: string, title: string, times: TimeHolder[], timeZeroNano: bigint): void {
  const metricsTable = new AsciiTable().setBorder("|", "-", "+", "+");

  metricsTable.setHeading("Connect at (ms)", "Connect time/duration (ms)", "Error");

  // Calculate p99
  const p99nano = getPercentile(
    times.map((x) => x.endTime - x.startTime),
    99.0
  );
  const p99 = Number(p99nano) / 1000000;

  metricsTable.addRow("p99", p99, "");

  const firstConnect = times[0];
  metricsTable.addRow(
    Number(firstConnect.startTime - timeZeroNano) / 1000000,
    Number(firstConnect.endTime - firstConnect.startTime) / 1000000,
    firstConnect.error == null ? "" : firstConnect.error.substring(0, Math.min(firstConnect.error.length, 100)).replace("\n", " ") + "..."
  );

  // Add rows for times exceeding p99
  for (const timeHolder of times) {
    if (Number(timeHolder.endTime - timeHolder.startTime) / 1000000 > p99) {
      metricsTable.addRow(
        Number(timeHolder.startTime - timeZeroNano) / 1000000,
        Number(timeHolder.endTime - timeHolder.startTime) / 1000000,
        timeHolder.error == null ? "" : timeHolder.error.substring(0, Math.min(timeHolder.error.length, 100)).replace("\n", " ") + "..."
      );
    }
  }

  const lastConnect = times[times.length - 1];
  metricsTable.addRow(
    Number(lastConnect.startTime - timeZeroNano) / 1000000,
    Number(lastConnect.endTime - lastConnect.startTime) / 1000000,
    lastConnect.error == null ? "" : lastConnect.error.substring(0, Math.min(lastConnect.error.length, 100)).replace("\n", " ") + "..."
  );

  logger.debug(`\n${host}: ${title}\n${renderTable(metricsTable, false)}`);
}

function getPercentile(input: bigint[], percentile: number): bigint {
  if (!input || input.length === 0) {
    return 0n;
  }

  const sortedList = [...input].sort((a, b) => Number(a - b));
  const rank = percentile === 0 ? 1 : Math.ceil((percentile / 100.0) * input.length);
  return sortedList[rank - 1];
}

function renderTable(table: AsciiTable, leftAlignForColumn0: boolean): string {
  if (leftAlignForColumn0) {
    table.setAlignLeft(0);
  }

  return table.toString();
}

function logUnhandledErrors(): void {
  for (const error of unhandledErrors) {
    logger.debug(`Unhandled exception: ${error.message}`);
  }
}
