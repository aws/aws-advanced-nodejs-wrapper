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

import { AwsPGClient } from "../../pg/lib";
import { PluginManager } from "../../common/lib";
import { PluginService } from "../../common/lib/plugin_service";
import { TelemetryFactory } from "../../common/lib/utils/telemetry/telemetry_factory";

export class TestConnectionWrapper extends AwsPGClient {
  constructor(config: any, pluginManager: PluginManager, pluginService: PluginService, telemetryFactory?: TelemetryFactory) {
    super(config);
    this.pluginManager = pluginManager;
    this.pluginService = pluginService;
    this.telemetryFactory = telemetryFactory ?? this.telemetryFactory;
  }
}
