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

import { logger } from "../../../../common/logutils";
import { TestEnvironment } from "./utils/test_environment";
import { DriverHelper } from "./utils/driver_helper";
import { ProxyHelper } from "./utils/proxy_helper";
import { AuroraTestUtility } from "./utils/aurora_test_utility";
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { anything } from "ts-mockito";
import { WrapperProperties } from "../../../../common/lib/wrapper_property";
import { features } from "./config";
import { MonitorServiceImpl } from "../../../../common/lib/plugins/efm/monitor_service";
import { PerfStat } from "./utils/perf_stat";
import { PerfTestUtility } from "./utils/perf_util";
import { PluginManager } from "../../../../common/lib";

const itIf =
  features.includes(TestEnvironmentFeatures.FAILOVER_SUPPORTED) &&
  features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  features.includes(TestEnvironmentFeatures.NETWORK_OUTAGES_ENABLED) &&
  !features.includes(TestEnvironmentFeatures.RUN_AUTOSCALING_TESTS_ONLY)
    ? it
    : it.skip;

const REPEAT_TIMES: number = process.env.REPEAT_TIMES ? Number(process.env.REPEAT_TIMES) : 5;
const PERF_FAILOVER_TIMEOUT_MS = 120000;
const failureDetectionTimeParams = [
  // Defaults
  [30000, 5000, 3, 5000],
  [30000, 5000, 3, 10000],
  [30000, 5000, 3, 15000],
  [30000, 5000, 3, 20000],
  [30000, 5000, 3, 25000],
  [30000, 5000, 3, 30000],
  [30000, 5000, 3, 35000],
  [30000, 5000, 3, 40000],
  [30000, 5000, 3, 50000],
  [30000, 5000, 3, 60000],

  // Aggressive detection scheme
  [6000, 1000, 1, 1000],
  [6000, 1000, 1, 2000],
  [6000, 1000, 1, 3000],
  [6000, 1000, 1, 4000],
  [6000, 1000, 1, 5000],
  [6000, 1000, 1, 6000],
  [6000, 1000, 1, 7000],
  [6000, 1000, 1, 8000],
  [6000, 1000, 1, 9000],
  [6000, 1000, 1, 10000]
];

let env: TestEnvironment;
let driver;
let initClientFunc: (props: any) => any;

let auroraTestUtility: AuroraTestUtility;
let enhancedFailureMonitoringPerfDataList: PerfStatMonitoring[] = [];

function initDefaultConfig(host: string, port: number): any {
  let config: any = {
    user: env.databaseInfo.username,
    host: host,
    database: env.databaseInfo.defaultDbName,
    password: env.databaseInfo.password,
    port: port,
    failoverTimeoutMs: 250000
  };
  config["clusterInstanceHostPattern"] = "?." + env.proxyDatabaseInfo.instanceEndpointSuffix;
  config = DriverHelper.addDriverSpecificConfiguration(config, env.engine, true);
  return config;
}

async function connectWithRetry(client: any): Promise<void> {
  let connectCount = 0;
  let clientConnected = false;
  while (!clientConnected && connectCount < 10) {
    try {
      await client.connect();
      clientConnected = true;
    } catch (error: any) {
      // ignore
      connectCount++;
    }
  }

  expect(clientConnected).toBe(true);
}

async function testFailureDetectionTimeEfmEnabled() {
  try {
    for (let i = 0; i < failureDetectionTimeParams.length; i++) {
      await executeFailureDetectionTimeEfmEnabled(
        failureDetectionTimeParams[i][0],
        failureDetectionTimeParams[i][1],
        failureDetectionTimeParams[i][2],
        failureDetectionTimeParams[i][3]
      );
    }
  } finally {
    PerfTestUtility.writePerfDataToFile(
      enhancedFailureMonitoringPerfDataList,
      `EnhancedMonitoringOnly_Db_${env.engine}_Instances_${env.instances.length}_Plugins_efm.xlsx`,
      "EfmOnly"
    );
  }
}

async function testFailureDetectionTimeFailoverAndEfmEnabled() {
  try {
    for (let i = 0; i < failureDetectionTimeParams.length; i++) {
      await executeFailureDetectionTimeFailoverAndEfmEnabled(
        failureDetectionTimeParams[i][0],
        failureDetectionTimeParams[i][1],
        failureDetectionTimeParams[i][2],
        failureDetectionTimeParams[i][3]
      );
    }
  } finally {
    PerfTestUtility.writePerfDataToFile(
      enhancedFailureMonitoringPerfDataList,
      `FailoverWithEnhancedMonitoring_Db_${env.engine}_Instances_${env.instances.length}_Plugins_efm.xlsx`,
      "FailoverWithEfm"
    );
  }
}

async function executeFailureDetectionTimeEfmEnabled(
  detectionTimeMillis: number,
  detectionIntervalMillis: number,
  detectionCount: number,
  sleepDelayMillis: number
) {
  auroraTestUtility = new AuroraTestUtility((await TestEnvironment.getCurrent()).region);
  const config = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.clusterEndpointPort);
  config["plugins"] = "efm";
  config[WrapperProperties.FAILURE_DETECTION_TIME_MS.name] = detectionTimeMillis;
  config[WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name] = detectionIntervalMillis;
  config[WrapperProperties.FAILURE_DETECTION_COUNT.name] = detectionCount;

  await executeTest(sleepDelayMillis, config, detectionTimeMillis, detectionIntervalMillis, detectionCount);
}

async function executeFailureDetectionTimeFailoverAndEfmEnabled(
  detectionTimeMillis: number,
  detectionIntervalMillis: number,
  detectionCount: number,
  sleepDelayMillis: number
) {
  const props = new Map();
  const config = await initDefaultConfig(env.proxyDatabaseInfo.writerInstanceEndpoint, env.proxyDatabaseInfo.clusterEndpointPort);
  config["plugins"] = "efm2,failover";
  config[WrapperProperties.FAILURE_DETECTION_TIME_MS.name] = detectionTimeMillis;
  config[WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.name] = detectionIntervalMillis;
  config[WrapperProperties.FAILURE_DETECTION_COUNT.name] = detectionCount;
  config[WrapperProperties.FAILOVER_TIMEOUT_MS.name] = PERF_FAILOVER_TIMEOUT_MS;
  config[WrapperProperties.FAILOVER_MODE.name] = "strict-reader";

  await executeTest(sleepDelayMillis, config, detectionTimeMillis, detectionIntervalMillis, detectionCount);
}

async function executeTest(
  sleepDelayMillis: number,
  config: any,
  detectionTimeMillis: number,
  detectionIntervalMillis: number,
  detectionCount: number
) {
  const data = new PerfStatMonitoring();
  await doMeasurePerformance(sleepDelayMillis, REPEAT_TIMES, data, config);
  data.paramDetectionTime = detectionTimeMillis;
  data.paramDetectionInterval = detectionIntervalMillis;
  data.paramDetectionCount = detectionCount;
  logger.debug("Collected data: " + data.toString());
  enhancedFailureMonitoringPerfDataList.push(data);
}

async function doMeasurePerformance(sleepDelayMillis: number, repeatTimes: number, data: PerfStatMonitoring, config: any) {
  let downTimeMillis: number = 0;
  const elapsedTimeMillis: number[] = [];

  for (let i = 0; i < repeatTimes; i++) {
    const client = initClientFunc(config);
    try {
      await connectWithRetry(client);
      const instanceHost = await auroraTestUtility.queryInstanceId(client);
      setTimeout(async () => {
        await ProxyHelper.disableConnectivity(env.engine, instanceHost);
        downTimeMillis = Date.now();
        logger.debug("Network outages started.");
      }, sleepDelayMillis);

      expect(await DriverHelper.executeQuery(env.engine, client, DriverHelper.getSleepQuery(env.engine, 60), 120000)).toThrow(anything());
    } catch (error: any) {
      // Calculate and add detection time.
      if (downTimeMillis === 0) {
        logger.warn("Network outages start time is undefined!");
      } else {
        const failureTimeMillis = Date.now() - downTimeMillis;
        logger.debug(`Time to detect failure: ${failureTimeMillis}`);
        elapsedTimeMillis.push(failureTimeMillis);
      }
    } finally {
      downTimeMillis = 0;
      try {
        await ProxyHelper.enableAllConnectivity();
        await client.end();
        MonitorServiceImpl.clearMonitors();
      } catch (error: any) {
        // ignore
      }
    }
  }

  const [min, max, total] = elapsedTimeMillis.reduce(
    ([min, max, sum], val) => {
      return [Math.min(val, min), Math.max(val, max), sum + val];
    },
    [elapsedTimeMillis[0], elapsedTimeMillis[0], 0]
  );

  const avg = Math.round(total / elapsedTimeMillis.length);
  logger.debug(`Calculated average failure detection time: ${total} / ${elapsedTimeMillis.length} = ${avg}`);

  data.paramNetworkOutageDelayMillis = sleepDelayMillis;
  data.minFailureDetectionTimeMillis = min;
  data.maxFailureDetectionTimeMillis = max;
  data.avgFailureDetectionTimeMillis = avg;
}

describe("performance", () => {
  beforeEach(async () => {
    enhancedFailureMonitoringPerfDataList = [];
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    initClientFunc = DriverHelper.getClient(driver);
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
    await ProxyHelper.enableAllConnectivity();
  });

  afterEach(async () => {
    await PluginManager.releaseResources();
    await TestEnvironment.verifyClusterStatus();
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  itIf(
    "failure detection with efm enabled",
    async () => {
      await testFailureDetectionTimeEfmEnabled();
    },
    13200000
  );

  itIf(
    "failure detection with failover and efm enabled",
    async () => {
      await testFailureDetectionTimeFailoverAndEfmEnabled();
    },
    13200000
  );
});

class PerfStatMonitoring implements PerfStat {
  paramNetworkOutageDelayMillis?: number;
  minFailureDetectionTimeMillis?: number;
  maxFailureDetectionTimeMillis?: number;
  avgFailureDetectionTimeMillis?: number;

  paramDetectionTime?: number;
  paramDetectionInterval?: number;
  paramDetectionCount?: number;

  writeHeader() {
    return [
      [
        "FailureDetectionGraceTime",
        "FailureDetectionInterval",
        "FailureDetectionCount",
        "NetworkOutageDelayMillis",
        "MinFailureDetectionTimeMillis",
        "MaxFailureDetectionTimeMillis",
        "AvgFailureDetectionTimeMillis"
      ]
    ];
  }

  writeData() {
    return [
      this.paramDetectionTime,
      this.paramDetectionInterval,
      this.paramDetectionCount,
      this.paramNetworkOutageDelayMillis,
      this.minFailureDetectionTimeMillis,
      this.maxFailureDetectionTimeMillis,
      this.avgFailureDetectionTimeMillis
    ];
  }

  toString(): string {
    return (
      `[paramDetectionTime=${this.paramDetectionTime}, ` +
      `paramDetectionInterval=${this.paramDetectionInterval}, ` +
      `paramDetectionCount=${this.paramDetectionCount}, ` +
      `paramNetworkOutageDelayMillis=${this.paramNetworkOutageDelayMillis}, ` +
      `minFailureDetectionTimeMillis=${this.minFailureDetectionTimeMillis}, ` +
      `maxFailureDetectionTimeMillis=${this.maxFailureDetectionTimeMillis} ` +
      `avgFailureDetectionTimeMillis=${this.avgFailureDetectionTimeMillis}]`
    );
  }
}
