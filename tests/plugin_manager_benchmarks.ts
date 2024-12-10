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

import { add, cycle, suite, save, complete, configure } from "benny";
import { ConnectionPlugin, PluginManager } from "../common/lib";
import { PluginServiceManagerContainer } from "../common/lib/plugin_service_manager_container";
import { instance, mock, when } from "ts-mockito";
import { ConnectionProvider } from "../common/lib/connection_provider";
import { HostInfoBuilder } from "../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../common/lib/host_availability/simple_host_availability_strategy";
import { PluginService } from "../common/lib/plugin_service";
import { HostListProviderService } from "../common/lib/host_list_provider_service";
import { HostChangeOptions } from "../common/lib/host_change_options";
import { WrapperProperties } from "../common/lib/wrapper_property";
import { NullTelemetryFactory } from "../common/lib/utils/telemetry/null_telemetry_factory";
import { ConnectionProviderManager } from "../common/lib/connection_provider_manager";
import { PgDatabaseDialect } from "../pg/lib/dialect/pg_database_dialect";
import { BenchmarkPluginFactory } from "./testplugin/benchmark_plugin_factory";
import { NodePostgresDriverDialect } from "../pg/lib/dialect/node_postgres_driver_dialect";
import { ConfigurationProfileBuilder } from "../common/lib/profile/configuration_profile_builder";
import { ConnectionPluginFactory } from "../common/lib/plugin_factory";
import { DefaultPlugin } from "../common/lib/plugins/default_plugin";
import { AwsPGClient } from "../pg/lib";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockHostListProviderService = mock<HostListProviderService>();
const mockPluginService = mock(PluginService);
const mockClient = mock(AwsPGClient);
const telemetryFactory = new NullTelemetryFactory();
when(mockPluginService.getTelemetryFactory()).thenReturn(telemetryFactory);
when(mockPluginService.getDialect()).thenReturn(new PgDatabaseDialect());
when(mockPluginService.getDriverDialect()).thenReturn(new NodePostgresDriverDialect());
when(mockPluginService.getCurrentClient()).thenReturn(mockClient);

const pluginServiceManagerContainer = new PluginServiceManagerContainer();
pluginServiceManagerContainer.pluginService = instance(mockPluginService);

const propsWithNoPlugins = new Map<string, any>();
const propsWithPlugins = new Map<string, any>();

WrapperProperties.PLUGINS.set(propsWithNoPlugins, "");

function getPluginManagerWithPlugins() {
  return new PluginManager(
    pluginServiceManagerContainer,
    propsWithPlugins,
    new ConnectionProviderManager(instance(mockConnectionProvider), null),
    new NullTelemetryFactory()
  );
}

function getPluginManagerWithNoPlugins() {
  return new PluginManager(
    pluginServiceManagerContainer,
    propsWithNoPlugins,
    new ConnectionProviderManager(instance(mockConnectionProvider), null),
    new NullTelemetryFactory()
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
  pluginManager.init(configurationProfile, plugins);
  return pluginManager;
}

suite(
  "Plugin Manager Benchmarks",

  configure({
    cases: {
      delay: 0.5
    }
  }),

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
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(10, instance(mockPluginService), propsWithPlugins);;
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
    const pluginManagerWithPlugins = await initPluginManagerWithPlugins(10, instance(mockPluginService), propsWithPlugins);;
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
