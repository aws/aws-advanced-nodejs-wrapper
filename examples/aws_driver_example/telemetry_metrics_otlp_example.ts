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
import { AwsPGClient } from "../../pg";

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

const client = new AwsPGClient({
  user: "username",
  host: "db-identifier.XYZ.us-east-2.rds.amazonaws.com",
  database: "database_name",
  password: "password",
  port: 5432,
  enableTelemetry: true,
  telemetryTracesBackend: "OTLP",
  telemetryMetricsBackend: "OTLP"
});

try {
  await client.connect();
  const result = (await client.query("select * from pg_catalog.aurora_db_instance_identifier()")).rows[0];
  console.log(result);
} finally {
  await client.end();
}
