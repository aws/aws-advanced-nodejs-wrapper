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

import { add, complete, configure, cycle, save, suite } from "benny";
import { ConnectionPlugin, ConnectionProvider, HostInfoBuilder, PluginManager } from "../common/lib";
import { PluginServiceManagerContainer } from "../common/lib/plugin_service_manager_container";
import { instance, mock, when } from "ts-mockito";
import { SimpleHostAvailabilityStrategy } from "../common/lib/host_availability/simple_host_availability_strategy";
import { PluginService, PluginServiceImpl } from "../common/lib/plugin_service";
import { HostListProviderService } from "../common/lib/host_list_provider_service";
import { HostChangeOptions } from "../common/lib/host_change_options";
import { WrapperProperties } from "../common/lib/wrapper_property";
import { DefaultPlugin } from "../common/lib/plugins/default_plugin";
import { BenchmarkPluginFactory } from "./testplugin/benchmark_plugin_factory";
import { OpenTelemetryFactory } from "../common/lib/utils/telemetry/open_telemetry_factory";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { context } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { ConnectionProviderManager } from "../common/lib/connection_provider_manager";
import { PgDatabaseDialect } from "../pg/lib/dialect/pg_database_dialect";
import { NodePostgresDriverDialect } from "../pg/lib/dialect/node_postgres_driver_dialect";
import { ConnectionPluginFactory } from "../common/lib/plugin_factory";
import { ConfigurationProfileBuilder } from "../common/lib/profile/configuration_profile_builder";
import { AwsPGClient } from "../pg/lib";
import { resourceFromAttributes } from "@opentelemetry/resources";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockHostListProviderService = mock<HostListProviderService>();
const mockPluginService = mock(PluginServiceImpl);
const mockClient = mock(AwsPGClient);
const telemetryFactory = new OpenTelemetryFactory();
when(mockPluginService.getTelemetryFactory()).thenReturn(telemetryFactory);
when(mockPluginService.getDialect()).thenReturn(new PgDatabaseDialect());
when(mockPluginService.getDriverDialect()).thenReturn(new NodePostgresDriverDialect());
when(mockPluginService.getCurrentClient()).thenReturn(mockClient);

const pluginServiceManagerContainer = new PluginServiceManagerContainer();
pluginServiceManagerContainer.pluginService = instance(mockPluginService);

const propsWithNoPlugins = new Map<string, any>();
const propsWithPlugins = new Map<string, any>();

WrapperProperties.PLUGINS.set(propsWithNoPlugins, "");
WrapperProperties.ENABLE_TELEMETRY.set(propsWithNoPlugins, true);
WrapperProperties.TELEMETRY_METRICS_BACKEND.set(propsWithNoPlugins, "OTLP");
WrapperProperties.TELEMETRY_TRACES_BACKEND.set(propsWithNoPlugins, "OTLP");
WrapperProperties.ENABLE_TELEMETRY.set(propsWithPlugins, true);
WrapperProperties.TELEMETRY_METRICS_BACKEND.set(propsWithPlugins, "OTLP");
WrapperProperties.TELEMETRY_TRACES_BACKEND.set(propsWithPlugins, "OTLP");

async function createPlugins(numPlugins: number, pluginService: PluginService, connectionProvider: ConnectionProvider, props: Map<string, any>) {
  const plugins = new Array<ConnectionPlugin>();
  for (let i = 0; i < numPlugins; i++) {
    plugins.push(await new BenchmarkPluginFactory().getInstance(pluginService, props));
  }
  plugins.push(new DefaultPlugin(pluginService, new ConnectionProviderManager(instance(mockConnectionProvider), null)));
  return plugins;
}

function getPluginManagerWithPlugins() {
  return new PluginManager(
    pluginServiceManagerContainer,
    propsWithPlugins,
    new ConnectionProviderManager(instance(mockConnectionProvider), null),
    telemetryFactory
  );
}

function getPluginManagerWithNoPlugins() {
  return new PluginManager(
    pluginServiceManagerContainer,
    propsWithNoPlugins,
    new ConnectionProviderManager(instance(mockConnectionProvider), null),
    telemetryFactory
  );
}

async function initPluginManagerWithPlugins(numPlugins: number, pluginService, props) {
  const pluginManager = getPluginManagerWithPlugins();
  const factories = new Array<typeof ConnectionPluginFactory>();
  const plugins = new Array<ConnectionPlugin>();
  for (let i = 0; i < numPlugins; i++) {
    factories.push(BenchmarkPluginFactory);
    plugins.push(await new BenchmarkPluginFactory().getInstance(pluginService, props));
  }
  plugins.push(new DefaultPlugin(pluginService, new ConnectionProviderManager(instance(mockConnectionProvider), null)));
  const configurationProfile = ConfigurationProfileBuilder.get().withName("benchmark").withPluginsFactories(factories).build();
  await pluginManager.init(configurationProfile, plugins);
  return pluginManager;
}

const traceExporter = new OTLPTraceExporter({ url: "http://localhost:4317" });
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "aws-advanced-nodejs-wrapper"
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter(),
  exportIntervalMillis: 1000
});

const contextManager = new AsyncHooksContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

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

// This enables the API to record telemetry.
sdk.start();

// Shut down the SDK on process exit.
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("Tracing and Metrics terminated"))
    .catch((error) => console.log("Error terminating tracing and metrics", error))
    .finally(() => process.exit(0));
});

suite(
  "Plugin Manager Benchmarks",

  configure({
    cases: {
      delay: 0.5
    }
  }),

  // TODO: to be done once configuration profiles are complete.
  // add("initPluginManagerWith10Plugins", async () => {
  //   const manager = getPluginManagerWithPlugins();
  //   return async () => await manager.init(await createPlugins(10, instance(mockPluginService), instance(mockConnectionProvider), propsWithPlugins));
  // }),
  //
  // add("initPluginManagerWithNoPlugins", async () => {
  //   const manager = getPluginManagerWithNoPlugins();
  //   return async () => await manager.init();
  // }),

  add("connectWithDefaultPlugins", async () => {
    const pluginManagerWithPlugins = getPluginManagerWithPlugins();
    await pluginManagerWithPlugins.init();
    return async () =>
      await pluginManagerWithPlugins.connect(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        true
      );
  }),

  add("connectWith2Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(2, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.connect(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        true
      );
  }),

  add("connectWith1Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(1, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.connect(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        true
      );
  }),

  add("connectWith5Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(5, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.connect(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        true
      );
  }),

  add("connectWith10Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(10, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.connect(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        true
      );
  }),

  add("connectWithNoPlugins", async () => {
    const pluginManagerWithNoPlugins = getPluginManagerWithNoPlugins();
    await pluginManagerWithNoPlugins.init();
    return async () =>
      await pluginManagerWithNoPlugins.connect(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        true
      );
  }),

  add("executeWithDefaultPlugins", async () => {
    const pluginManagerWithPlugins = getPluginManagerWithPlugins();
    await pluginManagerWithPlugins.init();
    return async () =>
      await pluginManagerWithPlugins.execute(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        "execute",
        () => Promise.resolve(1),
        null
      );
  }),

  add("executeWithNoPlugins", async () => {
    const pluginManagerWithNoPlugins = getPluginManagerWithNoPlugins();
    await pluginManagerWithNoPlugins.init();
    return async () =>
      await pluginManagerWithNoPlugins.execute(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithNoPlugins,
        "execute",
        () => Promise.resolve(1),
        null
      );
  }),

  add("executeWith1Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(1, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.execute(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        "execute",
        () => Promise.resolve(1),
        null
      );
  }),

  add("executeWith2Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(2, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.execute(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        "execute",
        () => Promise.resolve(1),
        null
      );
  }),

  add("executeWith5Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(5, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.execute(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        "execute",
        () => Promise.resolve(1),
        null
      );
  }),

  add("executeWith10Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(10, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.execute(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        "execute",
        () => Promise.resolve(1),
        null
      );
  }),

  add("initHostProvidersWithNoPlugins", async () => {
    const pluginManagerWithNoPlugins = getPluginManagerWithNoPlugins();
    await pluginManagerWithNoPlugins.init();
    return async () =>
      await pluginManagerWithNoPlugins.initHostProvider(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithNoPlugins,
        instance(mockHostListProviderService)
      );
  }),

  add("initHostProviderWithDefaultPlugins", async () => {
    const pluginManagerWithPlugins = getPluginManagerWithPlugins();
    await pluginManagerWithPlugins.init();
    return async () =>
      await pluginManagerWithPlugins.initHostProvider(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        instance(mockHostListProviderService)
      );
  }),

  add("initHostProviderWith1Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(1, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.initHostProvider(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        instance(mockHostListProviderService)
      );
  }),

  add("initHostProviderWith2Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(2, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.initHostProvider(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        instance(mockHostListProviderService)
      );
  }),

  add("initHostProviderWith5Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(5, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.initHostProvider(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        instance(mockHostListProviderService)
      );
  }),

  add("initHostProviderWith10Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(10, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.initHostProvider(
        new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
        propsWithPlugins,
        instance(mockHostListProviderService)
      );
  }),

  add("notifyConnectionChangedWithDefaultPlugins", async () => {
    const pluginManagerWithPlugins = getPluginManagerWithPlugins();
    await pluginManagerWithPlugins.init();
    return async () =>
      await pluginManagerWithPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("notifyConnectionChangedWithNoPlugins", async () => {
    const pluginManagerWithNoPlugins = getPluginManagerWithNoPlugins();
    await pluginManagerWithNoPlugins.init();
    return async () =>
      await pluginManagerWithNoPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("notifyConnectionChangedWith1Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(1, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("notifyConnectionChangedWith2Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(2, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("notifyConnectionChangedWith5Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(5, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("notifyConnectionChangedWith10Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(10, instance(mockPluginService), propsWithPlugins);
    return async () =>
      await pluginManagerWithPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("releaseResourcesWithNoPlugins", async () => {
    const pluginManagerWithNoPlugins = getPluginManagerWithNoPlugins();
    await pluginManagerWithNoPlugins.init();
    return async () => await PluginManager.releaseResources();
  }),

  add("releaseResourcesWith1Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(1, instance(mockPluginService), propsWithPlugins);
    return async () => await PluginManager.releaseResources();
  }),

  add("releaseResourcesWith2Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(2, instance(mockPluginService), propsWithPlugins);
    return async () => await PluginManager.releaseResources();
  }),

  add("releaseResourcesWith5Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(5, instance(mockPluginService), propsWithPlugins);
    return async () => await PluginManager.releaseResources();
  }),

  add("releaseResourcesWith10Plugins", async () => {
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(10, instance(mockPluginService), propsWithPlugins);
    return async () => await PluginManager.releaseResources();
  }),

  add("releaseResourcesWithDefaultPlugins", async () => {
    const pluginManagerWithPlugins = getPluginManagerWithPlugins();
    await pluginManagerWithPlugins.init();
    return async () => await PluginManager.releaseResources();
  }),

  cycle(),
  complete(),
  save({ file: "plugin_manager_benchmarks", format: "json", details: true }),
  save({ file: "plugin_manager_benchmarks", format: "csv", details: true }),
  save({ file: "plugin_manager_benchmarks", format: "chart.html", details: true })
);
