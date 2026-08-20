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

import { Event } from "./event";
import { Monitor } from "../monitoring/monitor";

/**
 * Event indicating that a monitor should be stopped.
 * Used by MonitorService to stop and remove monitors.
 */
export class MonitorStopEvent implements Event {
  readonly isImmediateDelivery = true;
  readonly monitorClass: new (...args: any[]) => Monitor;
  readonly key: unknown;

  constructor(monitorClass: new (...args: any[]) => Monitor, key: unknown) {
    this.monitorClass = monitorClass;
    this.key = key;
  }
}
