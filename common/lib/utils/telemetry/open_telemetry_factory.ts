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

import { TelemetryFactory } from "./telemetry_factory";
import { TelemetryCounter } from "./telemetry_counter";
import { TelemetryGauge } from "./telemetry_gauge";
import { TelemetryTraceLevel } from "./telemetry_trace_level";
import { TelemetryContext } from "./telemetry_context";
import { OpenTelemetryContext } from "./open_telemetry_context";
import { AwsWrapperError, IllegalArgumentError } from "../errors";
import { metrics, trace } from "@opentelemetry/api";
import { OpenTelemetryCounter } from "./open_telemetry_counter";
import { OpenTelemetryGauge } from "./open_telemetry_gauge";

export class OpenTelemetryFactory implements TelemetryFactory {
  static readonly INSTRUMENTATION_NAME = "aws-advanced-nodejs-wrapper";

  async init() {}

  createCounter(name: string): TelemetryCounter {
    if (!name) {
      throw new IllegalArgumentError("name");
    }

    const meter = metrics.getMeter(OpenTelemetryFactory.INSTRUMENTATION_NAME);
    return new OpenTelemetryCounter(meter, name.trim());
  }

  createGauge(name: string, callable: () => void): TelemetryGauge {
    if (!name) {
      throw new IllegalArgumentError("name");
    }
    const meter = metrics.getMeter(OpenTelemetryFactory.INSTRUMENTATION_NAME);
    return new OpenTelemetryGauge(meter, name.trim(), callable);
  }

  openTelemetryContext(name: string, traceLevel: TelemetryTraceLevel): TelemetryContext {
    return new OpenTelemetryContext(trace.getTracer(OpenTelemetryFactory.INSTRUMENTATION_NAME), name, traceLevel);
  }

  postCopy(telemetryContext: TelemetryContext, telemetryTraceLevel: TelemetryTraceLevel): Promise<void> {
    if (telemetryContext instanceof OpenTelemetryContext) {
      return OpenTelemetryContext.postCopy(telemetryContext, telemetryTraceLevel);
    }

    throw new AwsWrapperError("Wrong parameter type: " + telemetryContext.constructor.name);
  }
}
