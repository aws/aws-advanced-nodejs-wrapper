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

import { TelemetryGauge } from "./telemetry_gauge";
import { Meter, ObservableGauge } from "@opentelemetry/api";

export class OpenTelemetryGauge implements TelemetryGauge {
  readonly name: string;
  readonly meter: Meter;
  readonly gauge: ObservableGauge;

  constructor(meter: Meter, name: string, callback: () => void) {
    this.name = name;
    this.meter = meter;

    this.gauge = this.meter.createObservableGauge(name, {
      description: "Create observable gauge metric",
      unit: "1"
    });
    this.gauge.addCallback(callback);
  }
}
