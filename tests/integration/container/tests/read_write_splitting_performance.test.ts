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
import { TestEnvironmentFeatures } from "./utils/test_environment_features";
import { features, instanceCount } from "./config";
import { PerfStat } from "./utils/perf_stat";
import { PerfTestUtility } from "./utils/perf_util";
import { ConnectTimePlugin } from "../../../../common/lib/plugins/connect_time_plugin";
import { ExecuteTimePlugin } from "../../../../common/lib/plugins/execute_time_plugin";
import { TestDriver } from "./utils/test_driver";
import { ConnectionProviderManager } from "../../../../common/lib/connection_provider_manager";
import { InternalPooledConnectionProvider } from "../../../../common/lib/internal_pooled_connection_provider";

const itIf =
  features.includes(TestEnvironmentFeatures.FAILOVER_SUPPORTED) &&
  features.includes(TestEnvironmentFeatures.PERFORMANCE) &&
  features.includes(TestEnvironmentFeatures.NETWORK_OUTAGES_ENABLED) &&
  instanceCount >= 5
    ? it
    : it.skip;

const REPEAT_TIMES: number = process.env.REPEAT_TIMES ? Number(process.env.REPEAT_TIMES) : 10;

let env: TestEnvironment;
let driver: TestDriver;

let setReadOnlyPerfDataList: PerfStatSwitchConnection[] = [];

describe("rwperformance", () => {
  beforeEach(async () => {
    setReadOnlyPerfDataList = [];
    env = await TestEnvironment.getCurrent();
    driver = DriverHelper.getDriverForDatabaseEngine(env.engine);
    logger.info(`Test started: ${expect.getState().currentTestName}`);
    env = await TestEnvironment.getCurrent();
  });

  afterEach(async () => {
    logger.info(`Test finished: ${expect.getState().currentTestName}`);
  }, 1320000);

  itIf(
    "switch reader writer connection",
    async () => {
      const noPluginConfig = PerfTestUtility.initDefaultConfig(env, env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort);
      const noPluginData = await measurePerformance(noPluginConfig);

      const rwPluginConfig = initReadWritePluginConfig(env.databaseInfo.clusterEndpoint, env.databaseInfo.clusterEndpointPort);
      const rwPluginData = await measurePerformance(rwPluginConfig);

      let readerData = calculateReaderOverhead("Switch to reader", rwPluginData, noPluginData);
      let writerData = calculateWriterOverhead("Switch to writer (using cached connection)", rwPluginData, noPluginData);
      let readerCacheData = calculateReaderCacheOverhead("Switch to reader (using cached connection)", rwPluginData, noPluginData);

      setReadOnlyPerfDataList.push(readerData, writerData, readerCacheData);
      PerfTestUtility.writePerfDataToFile(
        setReadOnlyPerfDataList,
        `ReadWriteSplittingPerformanceResults_${env.engine}_Instances_${env.instances.length}_SwitchReaderWriterConnection.xlsx`,
        "SwitchConn"
      );

      setReadOnlyPerfDataList = [];

      // Internal connection pool results.
      const rwPluginWithPoolConfig = initReadWritePluginConfig(env.databaseInfo.writerInstanceEndpoint, env.databaseInfo.clusterEndpointPort);
      let provider = new InternalPooledConnectionProvider();
      rwPluginWithPoolConfig["connectionProvider"] = provider;
      const rwPluginWithPoolData = await measurePerformance(rwPluginWithPoolConfig);

      readerData = calculateReaderOverhead("Switch to reader", rwPluginWithPoolData, noPluginData);
      writerData = calculateWriterOverhead("Switch to writer (using cached connection)", rwPluginWithPoolData, noPluginData);
      readerCacheData = calculateReaderCacheOverhead("Switch to reader (using cached connection)", rwPluginWithPoolData, noPluginData);
      setReadOnlyPerfDataList.push(readerData, writerData, readerCacheData);
      PerfTestUtility.writePerfDataToFile(
        setReadOnlyPerfDataList,
        `ReadWriteSplittingPerformanceResults_${env.engine}_Instances_${env.instances.length}_SwitchReaderWriterConnection.xlsx`,
        "ICP"
      );

      await provider.releaseResources();

      setReadOnlyPerfDataList = [];

      // Create an internal connection pool for each instance.
      provider = new InternalPooledConnectionProvider();
      for (const instance of env.databaseInfo.instances) {
        if (instance.host && instance.port) {
          const instanceConfig = initReadWritePluginConfig(instance.host, instance.port);
          instanceConfig["connectionProvider"] = provider;
          const client = DriverHelper.getClient(driver)(instanceConfig);
          await PerfTestUtility.connectWithRetry(client);
          await client.setReadOnly(true);
          await client.setReadOnly(false);
          await client.end();
        }
      }

      const rwPluginWithPoolWithWarmUpData = await measurePerformance(rwPluginWithPoolConfig);

      readerData = calculateReaderOverhead("Switch to reader", rwPluginWithPoolWithWarmUpData, noPluginData);
      writerData = calculateWriterOverhead("Switch to writer (using cached connection)", rwPluginWithPoolWithWarmUpData, noPluginData);
      readerCacheData = calculateReaderCacheOverhead("Switch to reader (using cached connection)", rwPluginWithPoolWithWarmUpData, noPluginData);
      setReadOnlyPerfDataList.push(readerData, writerData, readerCacheData);
      PerfTestUtility.writePerfDataToFile(
        setReadOnlyPerfDataList,
        `ReadWriteSplittingPerformanceResults_${env.engine}_Instances_${env.instances.length}_SwitchReaderWriterConnection.xlsx`,
        "ICPWithWarmUp"
      );

      await provider.releaseResources();
    },
    13200000
  );
});

function calculateReaderOverhead(connectionSwitch: string, data1: Result, data2: Result): PerfStatSwitchConnection {
  const switchToReaderMinOverhead = data1.switchToReaderMin - data2.switchToReaderMin;
  const switchToReaderMaxOverhead = data1.switchToReaderMax - data2.switchToReaderMax;
  const switchToReaderAvgOverhead = data1.switchToReaderAvg - data2.switchToReaderAvg;
  const switchToReaderWithConnectTime = data1.switchToReaderWithConnectTime - data2.switchToReaderWithConnectTime;

  return new PerfStatSwitchConnection(
    connectionSwitch,
    switchToReaderMinOverhead,
    switchToReaderMaxOverhead,
    switchToReaderAvgOverhead,
    switchToReaderWithConnectTime
  );
}

function calculateReaderCacheOverhead(connectionSwitch: string, data1: Result, data2: Result): PerfStatSwitchConnection {
  const switchToReaderCachedMinOverhead = data1.switchToReaderCachedMin - data2.switchToReaderCachedMin;
  const switchToReaderCachedMaxOverhead = data1.switchToReaderCachedMax - data2.switchToReaderCachedMax;
  const switchToReaderCachedAvgOverhead = data1.switchToReaderCachedAvg - data2.switchToReaderCachedAvg;
  const switchToReaderCachedWithConnectTime = data1.switchToReaderCachedWithConnectTime - data2.switchToReaderCachedWithConnectTime;

  return new PerfStatSwitchConnection(
    connectionSwitch,
    switchToReaderCachedMinOverhead,
    switchToReaderCachedMaxOverhead,
    switchToReaderCachedAvgOverhead,
    switchToReaderCachedWithConnectTime
  );
}

function calculateWriterOverhead(connectionSwitch: string, data1: Result, data2: Result) {
  const switchToWriterMinOverhead = data1.switchToWriterMin - data2.switchToWriterMin;
  const switchToWriterMaxOverhead = data1.switchToWriterMax - data2.switchToWriterMax;
  const switchToWriterAvgOverhead = data1.switchToWriterAvg - data2.switchToWriterAvg;
  const switchToWriterWithConnectTime = data1.switchToWriterWithConnectTime - data2.switchToWriterWithConnectTime;

  return new PerfStatSwitchConnection(
    connectionSwitch,
    switchToWriterMinOverhead,
    switchToWriterMaxOverhead,
    switchToWriterAvgOverhead,
    switchToWriterWithConnectTime
  );
}

function initReadWritePluginConfig(host: string, port: number) {
  const config = PerfTestUtility.initDefaultConfig(env, host, port);
  config["plugins"] = "readWriteSplitting,connectTime,executeTime";
  config["clusterTopologyRefreshRateMs"] = 300000;
  return config;
}

async function measurePerformance(config: any): Promise<Result> {
  let switchToReaderStartTime;
  let switchToReaderCachedStartTime;
  let switchToWriterStartTime;
  const elapsedSwitchToReaderTimeNanos: bigint[] = [];
  const elapsedSwitchToReaderCachedTimeNanos: bigint[] = [];
  const elapsedSwitchToWriterTimeNanos: bigint[] = [];
  const elapsedSwitchToReaderWithConnectTimeNanos: bigint[] = [];
  const elapsedSwitchToReaderCachedWithConnectTimeNanos: bigint[] = [];
  const elapsedSwitchToWriterWithConnectTimeNanos: bigint[] = [];

  for (let i = 0; i < REPEAT_TIMES; i++) {
    logger.info(`Test iteration ${i}`);
    const client = DriverHelper.getClient(driver)(config);
    try {
      await PerfTestUtility.connectWithRetry(client);
      ConnectTimePlugin.resetConnectTime();
      ExecuteTimePlugin.resetExecuteTime();
      // Calculate time required to switch to a new reader connection.
      switchToReaderStartTime = getTimeInNanos();
      await client.setReadOnly(true);

      let connectTime = ConnectTimePlugin.getTotalConnectTime();
      let executionTime = ExecuteTimePlugin.getTotalExecuteTime();
      const time1 = getTimeInNanos() - switchToReaderStartTime;
      elapsedSwitchToReaderTimeNanos.push(time1 - connectTime - executionTime);
      elapsedSwitchToReaderWithConnectTimeNanos.push(time1 - executionTime);

      // Calculate time required to switch to an existing writer connection.
      ConnectTimePlugin.resetConnectTime();
      ExecuteTimePlugin.resetExecuteTime();

      switchToWriterStartTime = getTimeInNanos();
      await client.setReadOnly(false);

      connectTime = ConnectTimePlugin.getTotalConnectTime();
      executionTime = ExecuteTimePlugin.getTotalExecuteTime();
      const time2 = getTimeInNanos() - switchToWriterStartTime;
      elapsedSwitchToWriterTimeNanos.push(time2 - connectTime - executionTime);
      elapsedSwitchToWriterWithConnectTimeNanos.push(time2 - executionTime);

      // Calculate time required to switch to an existing reader connection.
      ConnectTimePlugin.resetConnectTime();
      ExecuteTimePlugin.resetExecuteTime();

      switchToReaderCachedStartTime = getTimeInNanos();
      await client.setReadOnly(true);

      connectTime = ConnectTimePlugin.getTotalConnectTime();
      executionTime = ExecuteTimePlugin.getTotalExecuteTime();
      const time3 = getTimeInNanos() - switchToReaderCachedStartTime;
      elapsedSwitchToReaderCachedTimeNanos.push(time3 - connectTime - executionTime);
      elapsedSwitchToReaderCachedWithConnectTimeNanos.push(time3 - executionTime);
    } finally {
      await client.end();
    }
  }

  const data = new Result();
  let [min, max, sum] = calculateStats(elapsedSwitchToReaderTimeNanos);
  let avg = sum / BigInt(elapsedSwitchToReaderTimeNanos.length);
  data.switchToReaderMin = min;
  data.switchToReaderMax = max;
  data.switchToReaderAvg = avg;
  data.switchToReaderWithConnectTime =
    elapsedSwitchToReaderWithConnectTimeNanos.reduce((sum, value) => {
      return sum + value;
    }, 0n) / BigInt(elapsedSwitchToReaderWithConnectTimeNanos.length);

  [min, max, sum] = calculateStats(elapsedSwitchToWriterTimeNanos);
  avg = sum / BigInt(elapsedSwitchToWriterTimeNanos.length);
  data.switchToWriterMin = min;
  data.switchToWriterMax = max;
  data.switchToWriterAvg = avg;
  data.switchToWriterWithConnectTime =
    elapsedSwitchToWriterWithConnectTimeNanos.reduce((sum, value) => {
      return sum + value;
    }, 0n) / BigInt(elapsedSwitchToWriterWithConnectTimeNanos.length);

  [min, max, sum] = calculateStats(elapsedSwitchToReaderCachedTimeNanos);
  avg = sum / BigInt(elapsedSwitchToReaderCachedTimeNanos.length);
  data.switchToReaderCachedMin = min;
  data.switchToReaderCachedMax = max;
  data.switchToReaderCachedAvg = avg;
  data.switchToReaderCachedWithConnectTime =
    elapsedSwitchToReaderCachedTimeNanos.reduce((sum, value) => {
      return sum + value;
    }, 0n) / BigInt(elapsedSwitchToReaderCachedWithConnectTimeNanos.length);

  return data;
}

function getTimeInNanos(): bigint {
  return process.hrtime.bigint();
}

function calculateStats(data: bigint[]): [bigint, bigint, bigint] {
  return data.reduce(
    ([min, max, sum], e) => {
      return [e < min ? e : min, e > max ? e : max, sum + e];
    },
    [data[0], data[0], 0n]
  );
}

class Result {
  switchToReaderMin: bigint = 0n;
  switchToReaderMax: bigint = 0n;
  switchToReaderAvg: bigint = 0n;
  switchToReaderWithConnectTime: bigint = 0n;

  switchToWriterMin: bigint = 0n;
  switchToWriterMax: bigint = 0n;
  switchToWriterAvg: bigint = 0n;
  switchToWriterWithConnectTime: bigint = 0n;

  switchToReaderCachedMin: bigint = 0n;
  switchToReaderCachedMax: bigint = 0n;
  switchToReaderCachedAvg: bigint = 0n;
  switchToReaderCachedWithConnectTime: bigint = 0n;
}

class PerfStatSwitchConnection implements PerfStat {
  connectionSwitch?: string;
  minOverheadTime?: bigint;
  maxOverheadTime?: bigint;
  avgOverheadTime?: bigint;
  avgOverheadWithConnectTime?: bigint;

  constructor(
    connectionSwitch: string,
    minOverheadTime: bigint,
    maxOverheadTime: bigint,
    avgOverheadTime: bigint,
    avgOverheadWithConnectTime: bigint
  ) {
    this.connectionSwitch = connectionSwitch;
    this.minOverheadTime = minOverheadTime;
    this.maxOverheadTime = maxOverheadTime;
    this.avgOverheadTime = avgOverheadTime;
    this.avgOverheadWithConnectTime = avgOverheadWithConnectTime;
  }

  writeHeader() {
    return [["ConnectionSwitch", "MinOverheadTime", "MaxOverheadTime", "AvgOverheadTime", "AvgOverheadWithConnectTime"]];
  }

  writeData(): (string | bigint | number | undefined)[] {
    return [
      this.connectionSwitch,
      this.minOverheadTime?.toString(),
      this.maxOverheadTime?.toString(),
      this.avgOverheadTime?.toString(),
      this.avgOverheadWithConnectTime?.toString()
    ];
  }

  toString(): string {
    return (
      `[connectionSwitch=${this.connectionSwitch}, ` +
      `minOverheadTime=${this.minOverheadTime}, ` +
      `maxOverheadTime=${this.maxOverheadTime}, ` +
      `avgOverheadTime=${this.avgOverheadTime}], ` +
      `avgOverheadWithConnectTime=${this.avgOverheadWithConnectTime}]`
    );
  }
}
