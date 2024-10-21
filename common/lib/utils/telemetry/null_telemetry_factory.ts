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
import { NullTelemetryCounter } from "./null_telemetry_counter";
import { NullTelemetryGauge } from "./null_telemetry_gauge";
import { NullTelemetryContext } from "./null_telemetry_context";

export class NullTelemetryFactory implements TelemetryFactory {
  async init() {}

  createCounter(name: string): TelemetryCounter {
    return new NullTelemetryCounter(name);
  }

  createGauge(name: string, callable: () => void): TelemetryGauge {
    return new NullTelemetryGauge(name);
  }

  openTelemetryContext(name: string, traceLevel: TelemetryTraceLevel): TelemetryContext {
    return new NullTelemetryContext(name);
  }

  async postCopy(telemetryContext: TelemetryContext, telemetryTraceLevel: TelemetryTraceLevel): Promise<void> {
    // Do nothing.
  }
}
