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

import { ConnectionPluginFactory } from "../../common/lib/plugin_factory";
import { PluginService } from "../../common/lib/plugin_service";
import { ConnectionPlugin } from "../../common/lib";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { Messages } from "../../common/lib/utils/messages";
import { BenchmarkPlugin } from "./benchmark_plugin";

export class BenchmarkPluginFactory extends ConnectionPluginFactory {
  async getInstance(pluginService: PluginService, properties: object): Promise<ConnectionPlugin> {
    try {
      return new BenchmarkPlugin();
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("ConnectionPluginChainBuilder.errorImportingPlugin", error.message, "BenchmarkPlugin"));
    }
  }
}
