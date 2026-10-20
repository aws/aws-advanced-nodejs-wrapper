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

import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { AwsPgClient } from "../../pg";

const sdk = new NodeSDK({
  serviceName: "aws-advanced-nodejs-wrapper",
  traceExporter: new OTLPTraceExporter({ url: "http://localhost:4317" }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: "http://localhost:4317" }),
      exportIntervalMillis: 1000
    })
  ]
});

// Registers the tracer and meter providers that the wrapper records against.
sdk.start();

// Flush any buffered telemetry before the process exits.
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("Tracing and Metrics terminated"))
    .catch((error) => console.log("Error terminating tracing and metrics", error))
    .finally(() => process.exit(0));
});

const client = new AwsPgClient({
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
