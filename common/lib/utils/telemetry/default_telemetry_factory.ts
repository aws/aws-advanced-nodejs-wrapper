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

import { WrapperProperties } from "../../wrapper_property";
import { AwsWrapperError } from "../errors";
import { TelemetryFactory } from "./telemetry_factory";
import { TelemetryCounter } from "./telemetry_counter";
import { TelemetryGauge } from "./telemetry_gauge";
import { TelemetryTraceLevel } from "./telemetry_trace_level";
import { TelemetryContext } from "./telemetry_context";
import { NullTelemetryFactory } from "./null_telemetry_factory";
import { toLower } from "lodash";
import { Messages } from "../messages";

export class DefaultTelemetryFactory implements TelemetryFactory {
  private readonly enableTelemetry: boolean;
  private readonly telemetryTracesBackend: string;
  private readonly telemetryMetricsBackend: string;
  private readonly telemetrySubmitTopLevel: boolean;
  private static openTelemetryFactory?: any;
  private static xrayTelemetryFactory?: any;
  private tracesTelemetryFactory?: TelemetryFactory;
  private metricsTelemetryFactory?: TelemetryFactory;

  constructor(properties: Map<string, any>) {
    this.enableTelemetry = WrapperProperties.ENABLE_TELEMETRY.get(properties);
    const telemetryTracesBackend = toLower(WrapperProperties.TELEMETRY_TRACES_BACKEND.get(properties));
    const telemetryMetricsBackend = toLower(WrapperProperties.TELEMETRY_METRICS_BACKEND.get(properties));
    this.telemetryTracesBackend = telemetryTracesBackend && this.enableTelemetry ? telemetryTracesBackend : "none";
    this.telemetryMetricsBackend = telemetryMetricsBackend && this.enableTelemetry ? telemetryMetricsBackend : "none";
    this.telemetrySubmitTopLevel = WrapperProperties.TELEMETRY_SUBMIT_TOPLEVEL.get(properties);
  }

  async init() {
    const tracingBackend = !this.enableTelemetry ? "none" : "tracing";
    const metricsBackend = !this.enableTelemetry ? "none" : "metrics";
    this.tracesTelemetryFactory =
      this.tracesTelemetryFactory ?? (await DefaultTelemetryFactory.getTelemetryFactory(this.telemetryTracesBackend, tracingBackend));
    this.metricsTelemetryFactory =
      this.metricsTelemetryFactory ?? (await DefaultTelemetryFactory.getTelemetryFactory(this.telemetryMetricsBackend, metricsBackend));
  }

  private static async getTelemetryFactory(backend: string, type: string) {
    try {
      switch (backend) {
        case "otlp":
          if (!DefaultTelemetryFactory.openTelemetryFactory) {
            DefaultTelemetryFactory.openTelemetryFactory = await import("./open_telemetry_factory");
          }
          return new DefaultTelemetryFactory.openTelemetryFactory.OpenTelemetryFactory();
        case "xray":
          if (!DefaultTelemetryFactory.xrayTelemetryFactory) {
            DefaultTelemetryFactory.xrayTelemetryFactory = await import("./xray_telemetry_factory");
          }
          return DefaultTelemetryFactory.xrayTelemetryFactory.XRayTelemetryFactory();
        case "none":
          return new NullTelemetryFactory();
        default:
          throw new AwsWrapperError(Messages.get("DefaultTelemetryFactory.invalidBackend", backend, type));
      }
    } catch (error: any) {
      if (error instanceof AwsWrapperError) {
        throw error;
      }
      throw new AwsWrapperError(Messages.get("DefaultTelemetryFactory.importFailure"));
    }
  }

  createCounter(name: string): TelemetryCounter {
    if (!this.metricsTelemetryFactory) {
      throw new AwsWrapperError(Messages.get("DefaultTelemetryFactory.missingMetricsBackend"));
    }
    return this.metricsTelemetryFactory.createCounter(name);
  }

  createGauge(name: string, callable: () => void): TelemetryGauge {
    if (!this.metricsTelemetryFactory) {
      throw new AwsWrapperError(Messages.get("DefaultTelemetryFactory.missingMetricsBackend"));
    }
    return this.metricsTelemetryFactory.createGauge(name, callable);
  }

  openTelemetryContext(name: string, traceLevel: TelemetryTraceLevel): TelemetryContext {
    if (!this.tracesTelemetryFactory) {
      throw new AwsWrapperError(Messages.get("DefaultTelemetryFactory.missingTracingBackend"));
    }

    let effectiveTraceLevel = traceLevel;
    if (!this.telemetrySubmitTopLevel && traceLevel === TelemetryTraceLevel.TOP_LEVEL) {
      effectiveTraceLevel = TelemetryTraceLevel.NESTED;
    }
    return this.tracesTelemetryFactory.openTelemetryContext(name, effectiveTraceLevel);
  }

  async postCopy(telemetryContext: TelemetryContext, telemetryTraceLevel: TelemetryTraceLevel): Promise<void> {
    if (!this.tracesTelemetryFactory) {
      throw new AwsWrapperError(Messages.get("DefaultTelemetryFactory.missingTracingBackend"));
    }

    return this.tracesTelemetryFactory.postCopy(telemetryContext, telemetryTraceLevel);
  }
}
