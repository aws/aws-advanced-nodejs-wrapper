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

import { TestEnvironmentInfo } from "./test_environment_info";
import { TestEnvironmentFeatures } from "./test_environment_features";
import { Toxiproxy } from "toxiproxy-node-client";
import { ProxyInfo } from "./proxy_info";
import { TestInstanceInfo } from "./test_instance_info";
import { TestProxyDatabaseInfo } from "./test_proxy_database_info";
import { TestDatabaseInfo } from "./test_database_info";
import { DatabaseEngine } from "./database_engine";
import { AuroraTestUtility } from "./aurora_test_utility";
import { DatabaseEngineDeployment } from "./database_engine_deployment";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { context } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { logger } from "../../../../../common/logutils";
import pkgPg from "pg";
import { ConnectionOptions, createConnection } from "mysql2/promise";
import { readFileSync } from "fs";

export class TestEnvironment {
  private static env?: TestEnvironment;

  private readonly _info: TestEnvironmentInfo;
  private proxies?: { [s: string]: ProxyInfo };

  constructor(testInfo: { [s: string]: any }) {
    this._info = new TestEnvironmentInfo(testInfo);
  }

  static async getCurrent(): Promise<TestEnvironment> {
    if (TestEnvironment.env === undefined) {
      TestEnvironment.env = await TestEnvironment.create();
    }

    return TestEnvironment.env;
  }

  static async verifyClusterStatus(auroraUtility?: AuroraTestUtility) {
    const info = TestEnvironment.env?.info;
    if (info?.request.deployment === DatabaseEngineDeployment.AURORA || info?.request.deployment === DatabaseEngineDeployment.RDS_MULTI_AZ_CLUSTER) {
      let remainingTries = 3;
      let success = false;

      while (remainingTries-- > 0 && !success) {
        try {
          if (auroraUtility === undefined) {
            auroraUtility = new AuroraTestUtility(info.region);
          }
          await auroraUtility.waitUntilClusterHasDesiredStatus(info.rdsDbName);
          info.databaseInfo.moveInstanceFirst(await auroraUtility.getClusterWriterInstanceId(info.rdsDbName));
          info.proxyDatabaseInfo.moveInstanceFirst(await auroraUtility.getClusterWriterInstanceId(info.rdsDbName));
          success = true;
        } catch (error: any) {
          switch (info?.request.deployment) {
            case DatabaseEngineDeployment.AURORA:
              await this.rebootAllClusterInstances();
              break;
            case DatabaseEngineDeployment.RDS_MULTI_AZ_CLUSTER:
              await this.rebootCluster();
              break;
            default:
              throw new Error(`Unsupported deployment ${info?.request.deployment}`);
          }
        }
      }

      if (!success) {
        fail(`Cluster ${info.rdsDbName} is not healthy`);
      }
    }
  }

  static async verifyAllInstancesUp() {
    const info = TestEnvironment.env?.info;
    const endTime = Date.now() + 3 * 60 * 1000; // 3min
    const instanceIds: (string | undefined)[] | undefined = info?.databaseInfo.instances.map((instance) => instance.instanceId);
    const instanceIdSet = new Set(instanceIds);

    while (instanceIdSet.size > 0 && Date.now() < endTime) {
      for (const instanceId of instanceIds) {
        if (!instanceId) {
          continue;
        }
        let client: any;
        switch (info?.request.engine) {
          case DatabaseEngine.PG:
            try {
              client = new pkgPg.Client({
                host: info?.databaseInfo.instances.find((instance) => instance.instanceId === instanceId).host,
                port: info?.databaseInfo.instanceEndpointPort ?? 5432,
                user: info?.databaseInfo.username,
                password: info?.databaseInfo.password,
                database: info?.databaseInfo.defaultDbName,
                query_timeout: 3000,
                connectionTimeoutMillis: 3000,
                ssl: {
                  ca: readFileSync("/app/global-bundle.pem").toString()
                }
              });
              await client.connect();

              await client.query("select 1");
              logger.info("Instance " + instanceId + " is up.");
              instanceIdSet.delete(instanceId);
            } catch (e: any) {
              // do nothing; let's continue checking
            } finally {
              if (client) {
                await client.end();
              }
            }
            break;
          case DatabaseEngine.MYSQL:
            try {
              client = await createConnection({
                host: info?.databaseInfo.instances.find((instance) => instance.instanceId === instanceId).host,
                port: info?.databaseInfo.instanceEndpointPort ?? 3306,
                user: info?.databaseInfo.username,
                password: info?.databaseInfo.password,
                database: info?.databaseInfo.defaultDbName,
                connectTimeout: 3000
              } as ConnectionOptions);

              await client.query({ sql: "select 1", timeout: 3000 });
              logger.info("Instance " + instanceId + " is up.");
              instanceIdSet.delete(instanceId);
            } catch (e: any) {
              // do nothing; let's continue checking
            } finally {
              if (client) {
                await client.end();
              }
            }
            break;
          default:
            throw new Error(`Unsupported engine ${info?.request.engine}`);
        }
      }
    }

    if (instanceIdSet.size > 0) {
      throw new Error("Some instances are not available: " + Array.from(instanceIdSet).join(", "));
    }
    logger.info("All instances are up.");
  }

  static async verifyAllInstancesHasRightState(...allowedStatuses: string[]) {
    const info = TestEnvironment.env?.info;
    const auroraUtility = new AuroraTestUtility(info?.region);
    if (!info?.rdsDbName) {
      fail(`Invalid cluster`);
    }
    const instanceIds: (string | undefined)[] | undefined = info?.databaseInfo.instances.map((instance) => instance.instanceId);
    for (const instance of instanceIds) {
      await auroraUtility.waitUntilInstanceHasRightState(instance, ...allowedStatuses);
    }
  }

  static async rebootAllClusterInstances() {
    const info = TestEnvironment.env?.info;
    const auroraUtility = new AuroraTestUtility(info?.region);
    if (!info?.rdsDbName) {
      fail(`Invalid cluster`);
    }
    await auroraUtility.waitUntilClusterHasDesiredStatus(info.rdsDbName!);

    const instanceIds: (string | undefined)[] | undefined = info?.databaseInfo.instances.map((instance) => instance.instanceId);
    for (const instance of instanceIds) {
      await auroraUtility.rebootInstance(instance);
    }
    await auroraUtility.waitUntilClusterHasDesiredStatus(info.rdsDbName!);
    for (const instance of instanceIds) {
      await auroraUtility.waitUntilInstanceHasRightState(instance, "available");
    }
  }

  static async rebootCluster() {
    const info = TestEnvironment.env?.info;
    const auroraUtility = new AuroraTestUtility(info?.region);
    if (!info?.rdsDbName) {
      fail(`Invalid cluster`);
    }
    await auroraUtility.waitUntilClusterHasDesiredStatus(info.rdsDbName!);

    const instanceIds: (string | undefined)[] | undefined = info?.databaseInfo.instances.map((instance) => instance.instanceId);
    for (const instance of instanceIds) {
      await auroraUtility.waitUntilInstanceHasRightState(
        instance,
        "available",
        "storage-optimization",
        "incompatible-credentials",
        "incompatible-parameters",
        "unavailable"
      );
      await auroraUtility.rebootInstance(instance);
    }
    for (const instance of instanceIds) {
      await auroraUtility.waitUntilInstanceHasRightState(instance, "available");
    }
  }

  static async create() {
    const infoJson = process.env.TEST_ENV_INFO_JSON;
    if (infoJson === undefined) {
      throw new Error("env var required");
    }

    const testInfo = JSON.parse(infoJson);
    const env = new TestEnvironment(testInfo);
    if (env.features.includes(TestEnvironmentFeatures.NETWORK_OUTAGES_ENABLED)) {
      await TestEnvironment.initProxies(env);
    }

    const contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);

    const traceExporter = new OTLPTraceExporter({
      url: `http://${env.info.tracesTelemetryInfo.endpoint}:${env.info.tracesTelemetryInfo.endpointPort}`
    });
    const resource = Resource.default().merge(
      new Resource({
        [ATTR_SERVICE_NAME]: "aws-advanced-nodejs-wrapper"
      })
    );

    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `http://${env.info.metricsTelemetryInfo.endpoint}:${env.info.metricsTelemetryInfo.endpointPort}`
      }),
      exportIntervalMillis: 1000
    });

    const sdk = new NodeSDK({
      textMapPropagator: new AWSXRayPropagator(),
      instrumentations: [
        new HttpInstrumentation(),
        new AwsInstrumentation({
          suppressInternalInstrumentation: true
        })
      ],
      resource: resource,
      traceExporter: traceExporter,
      metricReader: metricReader,
      idGenerator: new AWSXRayIdGenerator()
    });

    // this enables the API to record telemetry
    sdk.start();
    // gracefully shut down the SDK on process exit
    process.on("SIGTERM", () => {
      sdk
        .shutdown()
        .then(() => console.log("Tracing and Metrics terminated"))
        .catch((error) => console.log("Error terminating tracing and metrics", error))
        .finally(() => process.exit(0));
    });

    return env;
  }

  static async initProxies(environment: TestEnvironment) {
    if (environment.features.includes(TestEnvironmentFeatures.NETWORK_OUTAGES_ENABLED)) {
      environment.proxies = {};
      const proxyControlPort: number = environment.proxyDatabaseInfo.controlPort;
      for (let i = 0; i < environment.proxyInstances.length; i++) {
        const instance = environment.proxyInstances[i];
        if (instance.host === undefined || instance.instanceId === undefined) {
          throw new Error("no valid host");
        }

        const client = new Toxiproxy(TestEnvironment.createProxyUrl(instance.host, proxyControlPort));
        const proxies = await client.getAll();

        const host = environment.instances[i].host;
        if (host === undefined) {
          throw new Error("no host");
        }

        environment.proxies[instance.instanceId] = new ProxyInfo(proxies[environment.instances[i].url], host, proxyControlPort);
      }

      if (environment.proxyDatabaseInfo.clusterEndpoint != null && environment.proxyDatabaseInfo.clusterEndpoint !== "null") {
        const client = new Toxiproxy(TestEnvironment.createProxyUrl(environment.proxyDatabaseInfo.clusterEndpoint, proxyControlPort));
        const proxy = await client.get(`${environment.databaseInfo.clusterEndpoint}:${environment.databaseInfo.clusterEndpointPort}`);

        if (proxy !== undefined) {
          environment.proxies[environment.proxyDatabaseInfo.clusterEndpoint] = new ProxyInfo(
            proxy,
            environment.databaseInfo.clusterEndpoint,
            proxyControlPort
          );
        }
      }

      if (environment.proxyDatabaseInfo.clusterReadOnlyEndpoint != null && environment.proxyDatabaseInfo.clusterReadOnlyEndpoint !== "null") {
        const client = new Toxiproxy(TestEnvironment.createProxyUrl(environment.proxyDatabaseInfo.clusterReadOnlyEndpoint, proxyControlPort));
        const proxy = await client.get(`${environment.databaseInfo.clusterReadOnlyEndpoint}:${environment.databaseInfo.clusterReadOnlyEndpointPort}`);

        if (proxy !== undefined) {
          environment.proxies[environment.databaseInfo.clusterReadOnlyEndpoint] = new ProxyInfo(
            proxy,
            environment.databaseInfo.clusterReadOnlyEndpoint,
            proxyControlPort
          );
        }
      }
    }
  }

  getProxyInfo(instanceName: string) {
    if (this.proxies === undefined) {
      throw new Error("proxy not found");
    }
    const p: ProxyInfo = this.proxies[instanceName];
    if (p === undefined) {
      throw new Error("Proxy not found");
    }
    return p;
  }

  get proxyInfos(): ProxyInfo[] {
    if (this.proxies !== undefined) {
      return Object.values(this.proxies);
    }
    return [];
  }

  get info(): TestEnvironmentInfo {
    return this._info;
  }

  get features(): TestEnvironmentFeatures[] {
    return this.info.request.features;
  }

  get databaseInfo(): TestDatabaseInfo {
    return this.info.databaseInfo;
  }

  get instances(): TestInstanceInfo[] {
    return this.databaseInfo.instances;
  }

  get writer(): TestInstanceInfo {
    return this.instances[0];
  }

  get proxyDatabaseInfo(): TestProxyDatabaseInfo {
    return this.info.proxyDatabaseInfo;
  }

  get proxyInstances(): TestInstanceInfo[] {
    return this.info.proxyDatabaseInfo.instances;
  }

  get proxyWriter(): TestInstanceInfo {
    return this.proxyInstances[0];
  }

  get region(): string {
    return this.info.region;
  }

  get rdsEndpoint(): string {
    return this.info.rdsEndpoint;
  }

  get engine(): DatabaseEngine {
    return this.info.request.engine;
  }

  get deployment(): DatabaseEngineDeployment {
    return this.info.request.deployment;
  }

  get rdsDbName(): string {
    return this.info.rdsDbName;
  }

  private static createProxyUrl(host: string, port: number) {
    return `http://${host}:${port}`;
  }
}
