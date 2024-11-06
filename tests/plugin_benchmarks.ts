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
import { AwsPGClient } from "../pg/lib";
import { NullTelemetryFactory } from "../common/lib/utils/telemetry/null_telemetry_factory";
import { ConnectionProviderManager } from "../common/lib/connection_provider_manager";
import { PgClientWrapper } from "../common/lib/pg_client_wrapper";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockPluginService = mock(PluginService);
const mockClient = mock(AwsPGClient);

const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build();

const mockClientWrapper = new PgClientWrapper(instance(mockClient), hostInfo, new Map<string, any>());

const telemetryFactory = new NullTelemetryFactory();

when(mockClient.query(anything())).thenReturn();
when(mockPluginService.getCurrentHostInfo()).thenReturn(hostInfo);
when(mockPluginService.getTelemetryFactory()).thenReturn(telemetryFactory);
when(mockPluginService.getCurrentClient()).thenReturn(mockClientWrapper.client);

const connectionString = "my.domain.com";
const pluginServiceManagerContainer = new PluginServiceManagerContainer();
pluginServiceManagerContainer.pluginService = instance(mockPluginService);

function getProps(plugins: string) {
  const props = new Map();
  WrapperProperties.PLUGINS.set(props, plugins);
  WrapperProperties.HOST.set(props, connectionString);
  return props;
}

function getPluginManager(props: Map<string, any>) {
  return new PluginManager(
    pluginServiceManagerContainer,
    props,
    new ConnectionProviderManager(instance(mockConnectionProvider), null),
    new NullTelemetryFactory()
  );
}

suite(
  "Plugin benchmarks",

  configure({
    cases: {
      delay: 0.5
    }
  }),

  add("initAndReleaseBaseline", async () => {
    const props = getProps("");
    const pluginManager = getPluginManager(props);
    const wrapper = new TestConnectionWrapper(props, pluginManager, instance(mockPluginService));
    await pluginManager.init();
    await wrapper.releaseResources();
  }),

  add("initAndReleaseWithExecuteTimePlugin", async () => {
    const props = getProps("executeTime");
    const pluginManager = getPluginManager(props);
    const wrapper = new TestConnectionWrapper(props, pluginManager, instance(mockPluginService));
    await pluginManager.init();
    await wrapper.releaseResources();
  }),

  add("initAndReleaseWithReadWriteSplittingPlugin", async () => {
    const props = getProps("readWriteSplitting");
    const pluginManager = getPluginManager(props);
    const wrapper = new TestConnectionWrapper(props, pluginManager, instance(mockPluginService));
    await pluginManager.init();
    await wrapper.releaseResources();
  }),

  add("executeStatementBaseline", async () => {
    const props = getProps("");
    const pluginManager = getPluginManager(props);
    const wrapper = new TestConnectionWrapper(props, pluginManager, instance(mockPluginService));
    await pluginManager.init();
    return async () => await wrapper.executeQuery(props, "select 1", mockClientWrapper);
  }),

  add("executeStatementWithExecuteTimePlugin", async () => {
    const props = getProps("executeTime");
    const pluginManager = getPluginManager(props);
    const wrapper = new TestConnectionWrapper(props, pluginManager, instance(mockPluginService));
    await pluginManager.init();
    return async () => await wrapper.executeQuery(props, "select 1", mockClientWrapper);
  }),

  add("executeStatementWithFailoverPlugin", async () => {
    const props = getProps("failover");
    const pluginManager = getPluginManager(props);
    const wrapper = new TestConnectionWrapper(props, pluginManager, instance(mockPluginService));
    await pluginManager.init();
    return async () => await wrapper.executeQuery(props, "select 1", mockClientWrapper);
  }),

  cycle(),
  complete(),
  save({ file: "plugin_benchmarks", format: "json", details: true }),
  save({ file: "plugin_benchmarks", format: "csv", details: true }),
  save({ file: "plugin_benchmarks", format: "chart.html", details: true })
);
