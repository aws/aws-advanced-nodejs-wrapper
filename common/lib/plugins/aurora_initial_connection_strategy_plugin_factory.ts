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

import { ConnectionPluginFactory } from "../plugin_factory";
import { PluginService } from "../plugin_service";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";

export class AuroraInitialConnectionStrategyFactory extends ConnectionPluginFactory {
  private static auroraInitialConnectionStrategyPlugin: any;

  async getInstance(pluginService: PluginService, props: Map<string, any>) {
    try {
      if (!AuroraInitialConnectionStrategyFactory.auroraInitialConnectionStrategyPlugin) {
        AuroraInitialConnectionStrategyFactory.auroraInitialConnectionStrategyPlugin = await import("./aurora_initial_connection_strategy_plugin");
      }
      return new AuroraInitialConnectionStrategyFactory.auroraInitialConnectionStrategyPlugin.AuroraInitialConnectionStrategyPlugin(pluginService);
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("ConnectionPluginChainBuilder.errorImportingPlugin", "AuroraInitialConnectionStrategyPlugin"));
    }
  }
}
