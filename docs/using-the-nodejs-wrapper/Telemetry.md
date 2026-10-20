# Monitoring

Monitoring is the ability to gather data and insights on the execution of an application. Users will also be able to inspect the gathered data and determine potential actions to take depending on the data collected.

The Telemetry feature allows users to collect and visualize data of the AWS Advanced NodeJS Wrapper execution at a global level and at a plugin level. You can use this feature to monitor the performance of the wrapper as a whole or within specific plugins with your configurations, and determine whether the wrapper's performance meets your expectations.

## Terminology

The AWS Advanced NodeJS Wrapper provides telemetry data through two different forms: **Traces** and **Metrics**.

### Traces

Traces give an overview of what is happening in a specific section of the execution of an application. A trace is composed of a hierarchical sequence of segments, each of which contain basic information about the execution (e.g. duration), and whether that section was executed successfully.

In the AWS Advanced NodeJS Wrapper, a trace will be generated for every call made to the wrapper. Depending on whether the user application already has a trace open, it may be nested in the open trace or dropped. And then, for each enabled plugin, another segment will be created only for the plugin execution, linked to the call segment.

Traces from the AWS Advanced NodeJS Wrapper are submitted to [**AWS X-Ray**](https://aws.amazon.com/xray/).

### Metrics

Metrics are numeric data that was measured and collected through the execution of an application. Metrics can give insight on how many times an action (e.g. failover) has happened, and for actions that may happen multiple times, their success or failure rate (failover, cache hits, etc.), amongst other related information.

The AWS Advanced NodeJS Wrapper will submit metrics data to [**Amazon CloudWatch**](https://aws.amazon.com/cloudwatch/).

The list of available metrics for the AWS Advanced NodeJS Wrapper and its plugins is available in the [List of Metrics](#List-Of-Metrics) section of this page.

## Setting up the AWS Distro for OpenTelemetry Collector (ADOT Collector)

## Prerequisites

Before enabling the Telemetry feature, a few setup steps are required to ensure the monitoring data is properly emitted.

1. Install the telemetry packages for the backend you intend to use. The wrapper does not install them for you, and it pins no version beyond `@opentelemetry/api` and `aws-xray-sdk`.

> [!WARNING]
> The wrapper declares `@opentelemetry/api` and `aws-xray-sdk` as optional peer dependencies and reads whatever provider your application registers. If the packages for your chosen backend are missing, the wrapper fails on the first connection with `A tracing backend could not be found.`
>
> For `OTLP` traces and metrics:
>
> ```bash
> npm install @opentelemetry/api @opentelemetry/sdk-node \
>   @opentelemetry/sdk-metrics \
>   @opentelemetry/exporter-trace-otlp-grpc @opentelemetry/exporter-metrics-otlp-grpc
> ```
>
> For `XRAY` traces:
>
> ```bash
> npm install aws-xray-sdk
> ```
>
> `XRAY` applies to traces only. If you also want metrics, add the `OTLP` packages above, since `telemetryMetricsBackend` has no X-Ray option.

The wrapper imports only `@opentelemetry/api` on the `OTLP` path and only `aws-xray-sdk` on the `XRAY` path. The remaining packages register the provider and carry the data out. Without a registered provider the wrapper records against a no-op tracer and exports nothing. Drop `@opentelemetry/sdk-metrics` and `@opentelemetry/exporter-metrics-otlp-grpc` if you only want traces, or `@opentelemetry/exporter-trace-otlp-grpc` if you only want metrics.

`NodeSDK` builds its own context manager and resource and takes `serviceName` as a configuration field, so `@opentelemetry/context-async-hooks`, `@opentelemetry/resources` and `@opentelemetry/semantic-conventions` are not needed.

None of these four packages are needed either. Each one traces your application's own work:

| Package                                  | Needed for                                         |
| ---------------------------------------- | -------------------------------------------------- |
| `@opentelemetry/instrumentation-http`    | Tracing your application's own outbound HTTP calls |
| `@opentelemetry/instrumentation-aws-sdk` | Tracing your application's own AWS SDK calls       |
| `@opentelemetry/propagator-aws-xray`     | Propagating X-Ray trace headers across services    |
| `@opentelemetry/id-generator-aws-xray`   | Emitting trace IDs in the format X-Ray expects     |

> [!NOTE]
> The example below is written against the `0.22x` line of the OpenTelemetry experimental packages, which is what this wrapper is tested against. It also works on `0.300.0`, which restructured the SDK and requires Node 22.15.0 or later.

2. In order to visualize the telemetry data in the AWS Console, make sure you have an IAM user or role with permissions to [AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/security-iam.html) and [Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/auth-and-access-control-cw.html).

3. Download the [AWS Distro for OpenTelemetry Collector](https://aws-otel.github.io/docs/getting-started/collector) and set it up. The AWS Distro for OpenTelemetry Collector is responsible from receiving telemetry data from the application using the AWS Advanced NodeJS Wrapper and forward it to AWS. Both of those connections happen via HTTP, therefore URLs and ports need to be correctly configured for the collector.

> [!WARNING]
> The AWS Distro for OpenTelemetry Collector can be set up either locally or remotely. It is up to the user to decide where is best to set it up. If you decide to host it remotely, ensure that the application has the necessary permissions or allowlists to connect to the Collector.

> [!WARNING]
> The collector is an external application that is not part of the wrapper itself. Without a collector, the wrapper will collect monitoring data from its execution but that data will not be sent anywhere for visualization.

## Using Telemetry

Telemetry for the AWS Advanced NodeJS Wrapper is a monitoring strategy that overlooks all plugins enabled in [`plugins`](./UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) and is not a plugin in itself. Changes are not required in the `plugins` parameter to enable Telemetry.

In order to enable Telemetry in the AWS Advanced NodeJS Wrapper, you need to:

1. Set the `enableTelemetry` connection property to `true`.

2. Set up the recorders that will export the telemetry data from the code to the ADOT Collector.

Setting up the recorders require to instantiate an `OpenTelemetrySDK` in the application code prior to using the wrapper. Instantiating the `OpenTelemetrySDK` requires you to configure the endpoints where traces and metrics are being forwarded to.

The code sample below is a complete setup for `telemetryTracesBackend: "OTLP"` with `telemetryMetricsBackend: "OTLP"`, sending both the wrapper's traces and its metrics to the collector. Import it once, before you create any client.

```typescript
// telemetry.ts
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

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
    .then(() => console.log("Tracing and metrics terminated"))
    .catch((error) => console.log("Error terminating tracing and metrics", error))
    .finally(() => process.exit(0));
});
```

Add `instrumentations`, `textMapPropagator` or `idGenerator` only when you want to trace your application's own work alongside the wrapper's.

To send traces to X-Ray instead, set `telemetryTracesBackend: "XRAY"` and drop `traceExporter` from the configuration above. The wrapper opens its own X-Ray segments through `aws-xray-sdk`, so no OpenTelemetry tracing setup is involved. Metrics have no X-Ray backend, so leave `telemetryMetricsBackend` as `"OTLP"` and keep the `metricReaders` block.

Runnable versions of both setups are in the examples folder:

| Sample                                                                                                   | Traces | Metrics |
| -------------------------------------------------------------------------------------------------------- | ------ | ------- |
| [telemetry_metrics_otlp_example.ts](../../examples/aws_driver_example/telemetry_metrics_otlp_example.ts) | `OTLP` | `OTLP`  |
| [telemetry_tracing_xray_example.ts](../../examples/aws_driver_example/telemetry_tracing_xray_example.ts) | `XRAY` | `OTLP`  |

### Telemetry Parameters

In addition to the parameter that enables Telemetry, you can pass the following parameters to the AWS Advanced NodeJS Wrapper to configure how telemetry data will be forwarded.

| Parameter                 |  Value  | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Default Value |
| ------------------------- | :-----: | :------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `enableTelemetry`         | boolean |    No    | Telemetry will be enabled when this property is set to `true`, otherwise no telemetry data will be gathered during the execution of the wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `false`       |
| `telemetryTracesBackend`  | string  |    No    | Determines to which backend the gathered tracing data will be forwarded to. Possible values include: `NONE`, `XRAY`, and `OTLP`.<br>`NONE` indicates that the application will collect tracing data but this data will not be forwarded anywhere.<br>`XRAY` indicates that the traces will be collected by the AWS XRay Daemon.<br>`OTLP` indicates that the traces will be collected by the AWS OTEL Collector.                                                                                                                                                                                                            | `NONE`        |
| `telemetryMetricsBackend` | string  |    No    | Determines to which backend the gathered metrics data will be forwarded to. Possible values include: `NONE` and `OTLP`.<br>`NONE` indicates that the application will collect metrics data but this data will not be forwarded anywhere.<br>`OTLP` indicates that the metrics will be collected by the AWS OTEL Collector.                                                                                                                                                                                                                                                                                                  | `NONE`        |
| `telemetrySubmitTopLevel` | boolean |    No    | By default the wrapper will look for open traces in the users application prior to record telemetry data. If there is a current open trace, the traces created will be attached to that open trace. If not, all telemetry traces created will be top level. Setting the parameter to `false` means that every call to the wrapper will generate a trace with no direct parent trace attached to it. If there is already an open trace being recorded by the application, no wrapper traces will be created. See the [Nested tracing strategies section](#nested-tracing-strategies-using-amazon-xray) for more information. | `false`       |

## Nested tracing strategies using Amazon XRay

As you could see in the [Telemetry Parameters](#Telemetry-Parameters) section, the AWS Advanced NodeJS Wrapper allows users to determine which strategy for nested traces to use when using Telemetry.

Traces are hierarchical entities and it might be that the user application already has an open trace in a given sequence of code that connects to the AWS Advanced NodeJS Wrapper. In this case, the Telemetry feature allows users to determine which strategy to use for the Telemetry traces generated when using the wrapper.

A top level trace is a trace that has no link to any other parent trace, and is directly accessible from the list of submitted traces within XRay. In the following pictures, the top level traces of an application are displayed in AWS X-Ray.

<div style="text-align:center"><img src="../images/telemetry_top_level.png" /></div>

<div style="text-align:center"><img src="../images/telemetry_traces.png" /></div>

When a trace is hierarchically linked to a parent trace, we say that this trace is nested. An example of nested traces are the individual plugin traces for a given call. All the individual plugin traces are linked to a parent trace for the call. Those nested traces are illustrated in the image below.

<div style="text-align:center"><img src="../images/telemetry_nested.png" /></div>

Applications that interact with the AWS Advanced NodeJS Wrapper may or may not have already opened telemetry traces on their own. In this case, it is up to the user to determine how they want to mix both application and wrapper traces.

This can be done using the AWS Advanced NodeJS Wrapper's `telemetrySubmitTopLevel` property. This property allows users to choose to submit the wrapper traces always as top level traces or to submit them nested to the application traces.
The default value is set to `false`, which means the wrapper traces to always be nested into their application traces. That will happen unless there are no open application traces when the wrapper is running. In that case no wrapper traces will be collected or submitted. When the property is set to `true`, all the wrapper traces would be submitted top level traces. If the application has already open traces, it will not be possible for the wrapper traces to be top level and the wrapper traces therefore will not be submitted.

## List of Metrics

The AWS Advanced NodeJS Wrapper also submits a set of metrics to Amazon CloudWatch when the wrapper is used. These metrics are predefined, and they help give insight on what is happening inside the plugins when the plugins are used.

Metrics can be one of 3 types: counters, gauges or histograms.

### EFM plugin

| Metric name                        | Metric type | Description                                                                                         |
| ---------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| efm.connections.aborted            | Counter     | Number of times a connection was aborted after being defined as unhealthy by an EFM monitoring task |
| efm.hostUnhealthy.count.[INSTANCE] | Counter     | Number of times a specific instance has been defined as unhealthy                                   |

### Secrets Manager plugin

| Metric name                           | Metric type | Description                                                   |
| ------------------------------------- | ----------- | ------------------------------------------------------------- |
| secretsManager.fetchCredentials.count | Counter     | Number of times credentials were fetched from Secrets Manager |

### IAM plugin

| Metric name          | Metric type | Description                                  |
| -------------------- | ----------- | -------------------------------------------- |
| iam.fetchToken.count | Counter     | Number of times tokens were fetched from IAM |

### Failover plugin

| Metric name                            | Metric type | Description                                                 |
| -------------------------------------- | ----------- | ----------------------------------------------------------- |
| writerFailover.triggered.count         | Counter     | Number of times writer failover was triggered               |
| writerFailover.completed.success.count | Counter     | Number of times writer failover was completed and succeeded |
| writerFailover.completed.failed.count  | Counter     | Number of times writer failover was completed and failed    |
| readerFailover.triggered.count         | Counter     | Number of times reader failover was triggered               |
| readerFailover.completed.success.count | Counter     | Number of times reader failover was completed and succeeded |
| readerFailover.completed.failed.count  | Counter     | Number of times reader failover was completed and failed    |

### Stale DNS plugin

| Metric name             | Metric type | Description                            |
| ----------------------- | ----------- | -------------------------------------- |
| staleDNS.stale.detected | Counter     | Number of times DNS was detected stale |

### Federated Authentication plugin

| Metric name                    | Metric type | Description                                  |
| ------------------------------ | ----------- | -------------------------------------------- |
| federatedAuth.fetchToken.count | Counter     | Number of times tokens were fetched from IAM |

### OKTA plugin

| Metric name               | Metric type | Description                                  |
| ------------------------- | ----------- | -------------------------------------------- |
| oktaAuth.fetchToken.count | Counter     | Number of times tokens were fetched from IAM |
