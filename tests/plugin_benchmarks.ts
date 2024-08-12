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

import { anything, instance, mock, when } from "ts-mockito";
import { ConnectionProvider } from "../common/lib/connection_provider";
import { PluginService } from "../common/lib/plugin_service";
import { PluginServiceManagerContainer } from "../common/lib/plugin_service_manager_container";
import { WrapperProperties } from "../common/lib/wrapper_property";
import { PluginManager } from "../common/lib";
import { add, complete, configure, cycle, save, suite } from "benny";
import { TestConnectionWrapper } from "./testplugin/test_connection_wrapper";
import { HostInfoBuilder } from "../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../common/lib/host_availability/simple_host_availability_strategy";
import { ClientWrapper } from "../common/lib/client_wrapper";
import { AwsPGClient } from "../pg/lib";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockPluginService = mock(PluginService);
const mockClient = mock(AwsPGClient);

const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build();

const mockClientWrapper: ClientWrapper = {
  client: instance(mockClient),
  hostInfo: hostInfo,
  properties: new Map<string, any>()
};

when(mockClient.query(anything())).thenReturn();
when(mockPluginService.getCurrentHostInfo()).thenReturn(hostInfo);

const connectionString = "my.domain.com";
const pluginServiceManagerContainer = new PluginServiceManagerContainer();
pluginServiceManagerContainer.pluginService = instance(mockPluginService);

const propsExecute = new Map<string, any>();
const propsReadWrite = new Map<string, any>();
const props = new Map<string, any>();

WrapperProperties.PLUGINS.set(propsExecute, "executeTime");
WrapperProperties.PLUGINS.set(propsReadWrite, "readWriteSplitting");
WrapperProperties.PLUGINS.set(props, "");
WrapperProperties.HOST.set(propsExecute, connectionString);
WrapperProperties.HOST.set(propsReadWrite, connectionString);
WrapperProperties.HOST.set(props, connectionString);

const pluginManagerExecute = new PluginManager(pluginServiceManagerContainer, propsExecute, instance(mockConnectionProvider), null);
const pluginManagerReadWrite = new PluginManager(pluginServiceManagerContainer, propsReadWrite, instance(mockConnectionProvider), null);
const pluginManager = new PluginManager(pluginServiceManagerContainer, props, instance(mockConnectionProvider), null);

suite(
  "Plugin benchmarks",

  configure({
    cases: {
      delay: 0.5
    }
  }),

  add("initAndReleaseBaseline", async () => {
    const wrapper = new TestConnectionWrapper(props, pluginManager, instance(mockPluginService));
    await pluginManager.init();
    await wrapper.releaseResources();
    await wrapper.end();
  }),

  add("initAndReleaseWithExecuteTimePlugin", async () => {
    const wrapper = new TestConnectionWrapper(propsExecute, pluginManagerExecute, instance(mockPluginService));
    await pluginManagerExecute.init();
    await wrapper.releaseResources();
    await wrapper.end();
  }),

  add("initAndReleaseWithReadWriteSplittingPlugin", async () => {
    const wrapper = new TestConnectionWrapper(propsReadWrite, pluginManagerReadWrite, instance(mockPluginService));
    await pluginManagerReadWrite.init();
    await wrapper.releaseResources();
    await wrapper.end();
  }),

  add("executeStatementBaseline", async () => {
    const wrapper = new TestConnectionWrapper(propsExecute, pluginManagerExecute, instance(mockPluginService));
    await pluginManagerReadWrite.init();
    await wrapper.end();
  }),

  add("executeStatementWithExecuteTimePlugin", async () => {
    const wrapper = new TestConnectionWrapper(propsExecute, pluginManagerExecute, instance(mockPluginService));
    await pluginManagerReadWrite.init();
    await wrapper.executeQuery(propsExecute, "select 1", mockClientWrapper);
    await wrapper.end();
  }),

  cycle(),
  complete(),
  save({ file: "plugin_benchmarks", format: "json", details: true }),
  save({ file: "plugin_benchmarks", format: "chart.html", details: true })
);
