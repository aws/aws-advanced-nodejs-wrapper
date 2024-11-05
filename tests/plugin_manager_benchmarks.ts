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
import { DefaultPlugin } from "../common/lib/plugins/default_plugin";
import { BenchmarkPluginFactory } from "./testplugin/benchmark_plugin_factory";
import { NullTelemetryFactory } from "../common/lib/utils/telemetry/null_telemetry_factory";
import { PgDatabaseDialect } from "../pg/lib/dialect/pg_database_dialect";
import { NodePostgresDriverDialect } from "../pg/lib/dialect/node_postgres_driver_dialect";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockHostListProviderService = mock<HostListProviderService>();
const mockPluginService = mock(PluginService);
const telemetryFactory = new NullTelemetryFactory();
when(mockPluginService.getTelemetryFactory()).thenReturn(telemetryFactory);
when(mockPluginService.getDialect()).thenReturn(new PgDatabaseDialect());
when(mockPluginService.getDriverDialect()).thenReturn(new NodePostgresDriverDialect());

const pluginServiceManagerContainer = new PluginServiceManagerContainer();
pluginServiceManagerContainer.pluginService = instance(mockPluginService);

const propsWithNoPlugins = new Map<string, any>();
const propsWithPlugins = new Map<string, any>();

WrapperProperties.PLUGINS.set(propsWithNoPlugins, "");

const pluginManagerWithNoPlugins = new PluginManager(pluginServiceManagerContainer, propsWithNoPlugins, telemetryFactory);
const pluginManagerWithPlugins = new PluginManager(pluginServiceManagerContainer, propsWithPlugins, telemetryFactory);

async function createPlugins(pluginService: PluginService, connectionProvider: ConnectionProvider, props: Map<string, any>) {
  const plugins = new Array<ConnectionPlugin>();
  for (let i = 0; i < 10; i++) {
    plugins.push(await new BenchmarkPluginFactory().getInstance(pluginService, props));
  }
  plugins.push(new DefaultPlugin(pluginService));
  return plugins;
}

suite(
  "Plugin Manager Benchmarks",

  configure({
    cases: {
      delay: 0.5
    }
  }),

  add("initPluginManagerWithPlugins", async () => {
    const manager = new PluginManager(pluginServiceManagerContainer, propsWithPlugins, new NullTelemetryFactory());
    await manager.init(await createPlugins(instance(mockPluginService), instance(mockConnectionProvider), propsWithPlugins));
  }),

  add("initPluginManagerWithNoPlugins", async () => {
    const manager = new PluginManager(pluginServiceManagerContainer, propsWithNoPlugins, new NullTelemetryFactory());
    await manager.init();
  }),

  add("connectWithPlugins", async () => {
    await pluginManagerWithPlugins.init(await createPlugins(instance(mockPluginService), instance(mockConnectionProvider), propsWithPlugins));
    await pluginManagerWithPlugins.connect(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithPlugins,
      true
    );
  }),

  add("connectWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.init();
    await pluginManagerWithNoPlugins.connect(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithPlugins,
      true
    );
  }),

  add("executeWithPlugins", async () => {
    await pluginManagerWithPlugins.init(await createPlugins(instance(mockPluginService), instance(mockConnectionProvider), propsWithPlugins));
    await pluginManagerWithPlugins.execute(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithPlugins,
      "execute",
      () => Promise.resolve(1),
      null
    );
  }),

  add("executeWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.init();
    await pluginManagerWithNoPlugins.execute(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithNoPlugins,
      "execute",
      () => Promise.resolve(1),
      null
    );
  }),

  add("initHostProviderWithPlugins", async () => {
    await pluginManagerWithPlugins.init(await createPlugins(instance(mockPluginService), instance(mockConnectionProvider), propsWithPlugins));
    await pluginManagerWithPlugins.initHostProvider(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithPlugins,
      instance(mockHostListProviderService)
    );
  }),

  add("initHostProvidersWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.init();
    await pluginManagerWithNoPlugins.initHostProvider(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithNoPlugins,
      instance(mockHostListProviderService)
    );
  }),

  add("notifyConnectionChangedWithPlugins", async () => {
    await pluginManagerWithPlugins.init(await createPlugins(instance(mockPluginService), instance(mockConnectionProvider), propsWithPlugins));
    await pluginManagerWithPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("notifyConnectionChangedWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.init();
    await pluginManagerWithNoPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("releaseResourcesWithPlugins", async () => {
    await pluginManagerWithPlugins.releaseResources();
  }),

  add("releaseResourcesWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.releaseResources();
  }),

  cycle(),
  complete(),
  save({ file: "plugin_manager_benchmarks", format: "json", details: true }),
  save({ file: "plugin_manager_benchmarks", format: "csv", details: true }),
  save({ file: "plugin_manager_benchmarks", format: "chart.html", details: true })
);
