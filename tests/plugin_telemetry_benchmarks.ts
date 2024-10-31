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
import { OpenTelemetryFactory } from "../common/lib/utils/telemetry/open_telemetry_factory";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { Resource } from "@opentelemetry/resources";
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
import { PgClientWrapper } from "../common/lib/pg_client_wrapper";

const mockConnectionProvider = mock<ConnectionProvider>();
const mockPluginService = mock(PluginService);
const mockClient = mock(AwsPGClient);

const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build();

const mockClientWrapper = new PgClientWrapper(instance(mockClient), hostInfo, new Map<string, any>());

const telemetryFactory = new OpenTelemetryFactory();

when(mockClient.query(anything())).thenReturn();
when(mockPluginService.getCurrentHostInfo()).thenReturn(hostInfo);
when(mockPluginService.getTelemetryFactory()).thenReturn(telemetryFactory);
when(mockPluginService.getCurrentClient()).thenReturn(mockClientWrapper.client);

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
WrapperProperties.ENABLE_TELEMETRY.set(propsExecute, true);
WrapperProperties.ENABLE_TELEMETRY.set(propsExecute, true);
WrapperProperties.ENABLE_TELEMETRY.set(propsExecute, true);
WrapperProperties.TELEMETRY_METRICS_BACKEND.set(propsExecute, "OTLP");
WrapperProperties.TELEMETRY_METRICS_BACKEND.set(propsReadWrite, "OTLP");
WrapperProperties.TELEMETRY_METRICS_BACKEND.set(props, "OTLP");
WrapperProperties.TELEMETRY_TRACES_BACKEND.set(propsExecute, "OTLP");
WrapperProperties.TELEMETRY_TRACES_BACKEND.set(propsReadWrite, "OTLP");
WrapperProperties.TELEMETRY_TRACES_BACKEND.set(props, "OTLP");

const pluginManagerExecute = new PluginManager(
  pluginServiceManagerContainer,
  propsExecute,
  new ConnectionProviderManager(instance(mockConnectionProvider), null),
  telemetryFactory
);
const pluginManagerReadWrite = new PluginManager(
  pluginServiceManagerContainer,
  propsReadWrite,
  new ConnectionProviderManager(instance(mockConnectionProvider), null),
  telemetryFactory
);
const pluginManager = new PluginManager(
  pluginServiceManagerContainer,
  props,
  new ConnectionProviderManager(instance(mockConnectionProvider), null),
  new NullTelemetryFactory()
);

const traceExporter = new OTLPTraceExporter({ url: "http://localhost:4317" });
const resource = Resource.default().merge(
  new Resource({
    [ATTR_SERVICE_NAME]: "aws-advanced-nodejs-wrapper"
  })
);

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
    await pluginManagerExecute.init();
    await wrapper.end();
  }),

  add("executeStatementWithExecuteTimePlugin", async () => {
    const wrapper = new TestConnectionWrapper(propsExecute, pluginManagerExecute, instance(mockPluginService));
    await pluginManagerExecute.init();
    await wrapper.executeQuery(propsExecute, "select 1", mockClientWrapper);
    await wrapper.end();
  }),

  cycle(),
  complete(),
  save({ file: "plugin_benchmarks", format: "json", details: true }),
  save({ file: "plugin_benchmarks", format: "csv", details: true }),
  save({ file: "plugin_benchmarks", format: "chart.html", details: true })
);
