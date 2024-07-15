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

import { instance, mock, when } from "ts-mockito";
import { ConnectionProvider } from "../common/lib/connection_provider";
import { PluginService } from "../common/lib/plugin_service";
import { PluginServiceManagerContainer } from "../common/lib/plugin_service_manager_container";
import { WrapperProperties } from "../common/lib/wrapper_property";
import { PluginManager } from "../common/lib";
import { add, complete, cycle, save, suite } from "benny";
import { AwsClient } from "../common/lib/aws_client";
import { TestConnectionWrapper } from "./testplugin/test_connection_wrapper";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockPluginService = mock(PluginService);
const mockClient = mock<AwsClient>();

const CONNECTION_STRING = "my.domain.com";
const pluginServiceManagerContainer = new PluginServiceManagerContainer();
pluginServiceManagerContainer.pluginService = instance(mockPluginService);

const propsExecute = new Map<string, any>();
const propsReadWrite = new Map<string, any>();
const props = new Map<string, any>();
WrapperProperties.PLUGINS.set(propsExecute, "executeTime");
WrapperProperties.PLUGINS.set(propsReadWrite, "readWriteSplitting");
WrapperProperties.HOST.set(propsExecute, CONNECTION_STRING);
WrapperProperties.HOST.set(propsReadWrite, CONNECTION_STRING);
WrapperProperties.HOST.set(props, CONNECTION_STRING);

const pluginManagerExecute = new PluginManager(pluginServiceManagerContainer, propsExecute, instance(mockConnectionProvider), null);
const pluginManagerReadWrite = new PluginManager(pluginServiceManagerContainer, propsReadWrite, instance(mockConnectionProvider), null);
const pluginManager = new PluginManager(pluginServiceManagerContainer, props, instance(mockConnectionProvider), null);

when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClient));

suite(
  "Plugin benchmarks",

  add("initAndReleaseBaseline", async () => {}),

  add("initAndReleaseWithExecuteTimePlugin", async () => {
    await pluginManagerExecute.init();
    const wrapper = new TestConnectionWrapper(propsExecute, pluginManagerExecute, instance(mockPluginService));
    try {
      // Uncomment once releaseResources implemented
      // await wrapper.releaseResources();
      await wrapper.end();
    } catch (e) {
      /* empty */
    }
  }),

  add("initAndReleaseWithReadWriteSplittingPlugin", async () => {
    await pluginManagerReadWrite.init();
    const wrapper = new TestConnectionWrapper(propsReadWrite, pluginManagerReadWrite, instance(mockPluginService));
    try {
      // Uncomment once releaseResources implemented
      // await wrapper.releaseResources();
      await wrapper.end();
    } catch (e) {
      /* empty */
    }
  }),

  add("executeStatementBaseline", async () => {
    await pluginManager.init();
    const wrapper = new TestConnectionWrapper({}, pluginManager, instance(mockPluginService));
    try {
      await wrapper.executeQuery(props, "select 1");
      await wrapper.end();
    } catch (e) {
      /* empty */
    }
  }),

  add("executeStatementWithExecuteTimePlugin", async () => {
    await pluginManagerExecute.init();
    const wrapper = new TestConnectionWrapper(propsExecute, pluginManagerExecute, instance(mockPluginService));
    try {
      await wrapper.executeQuery(propsExecute, "select 1");
      await wrapper.end();
    } catch (e) {
      /* empty */
    }
  }),

  cycle(),
  complete(),
  save({ file: "plugin_benchmarks", format: "json", details: true }),
  save({ file: "plugin_benchmarks", format: "chart.html", details: true })
);