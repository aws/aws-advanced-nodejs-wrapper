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

import { add, cycle, suite, save, complete } from "benny";
import { PluginManager } from "../common/lib";
import { PluginServiceManagerContainer } from "../common/lib/plugin_service_manager_container";
import { instance, mock, when } from "ts-mockito";
import { ConnectionProvider } from "../common/lib/connection_provider";
import { HostInfoBuilder } from "../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../common/lib/host_availability/simple_host_availability_strategy";
import { PluginService } from "../common/lib/plugin_service";
import { WrapperProperties } from "../common/lib/wrapper_property";
import { BenchmarkPlugin } from "./testplugin/benchmark_plugin";
import { HostListProviderService } from "../common/lib/host_list_provider_service";
import { HostChangeOptions } from "../common/lib/host_change_options";
import { AwsClient } from "../common/lib/aws_client";
import { DefaultPlugin } from "../common/lib/plugins/default_plugin";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockHostListProviderService = mock<HostListProviderService>();
const mockPluginService = mock(PluginService);
const mockClient = mock<AwsClient>();
const pluginServiceManagerContainer = new PluginServiceManagerContainer();
const propsWithNoPlugins = new Map<string, any>();
const propsWithPlugins = new Map<string, any>();
WrapperProperties.PLUGINS.set(propsWithPlugins, "benchmarkPlugin");
const pluginManagerWithNoPlugins = new PluginManager(pluginServiceManagerContainer, propsWithNoPlugins, instance(mockConnectionProvider), null);
const pluginManagerWithPlugins = new PluginManager(pluginServiceManagerContainer, propsWithPlugins, instance(mockConnectionProvider), null);
// await pluginManagerWithPlugins.init();
// await pluginManagerWithNoPlugins.init();
const benchmarkPlugin = new BenchmarkPlugin();
pluginManagerWithPlugins["_plugins"].push(benchmarkPlugin);
pluginManagerWithPlugins["_plugins"].push(new DefaultPlugin(instance(mockPluginService), instance(mockConnectionProvider), null, undefined));
pluginManagerWithNoPlugins["_plugins"].push(new DefaultPlugin(instance(mockPluginService), instance(mockConnectionProvider), null, undefined));

when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClient));

suite(
  "Connection Plugin Manager Benchmarks",

  add("initConnectionPluginManagerWithNoPlugins", async () => {
    const manager = new PluginManager(pluginServiceManagerContainer, propsWithNoPlugins, instance(mockConnectionProvider), null);
    await manager.init();
  }),

  add("initConnectionPluginManagerWithPlugins", async () => {
    const manager = new PluginManager(pluginServiceManagerContainer, propsWithPlugins, instance(mockConnectionProvider), null);
    await manager.init();
  }),

  add("connectWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.connect(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithNoPlugins,
      true
    );
  }),

  add("connectWithPlugins", async () => {
    await pluginManagerWithPlugins.connect(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithPlugins,
      true
    );
  }),

  add("executeWithPlugins", async () => {
    await pluginManagerWithPlugins.execute(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithPlugins,
      "execute",
      () => Promise.resolve(1),
      null
    );
  }),

  add("executeWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.execute(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithNoPlugins,
      "execute",
      () => Promise.resolve(1),
      null
    );
  }),

  add("initHostProviderWithPlugins", async () => {
    await pluginManagerWithPlugins.initHostProvider(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithPlugins,
      instance(mockHostListProviderService)
    );
  }),

  add("initHostProvidersWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.initHostProvider(
      new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build(),
      propsWithNoPlugins,
      instance(mockHostListProviderService)
    );
  }),

  add("notifyConnectionChangedWithPlugins", async () => {
    await pluginManagerWithPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  add("notifyConnectionChangedWithNoPlugins", async () => {
    await pluginManagerWithNoPlugins.notifyConnectionChanged(new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]), null);
  }),

  cycle(),
  complete(),
  save({ file: "connect_benchmarks", format: "json", details: true }),
  save({ file: "connect_benchmarks", format: "chart.html", details: true })
);
