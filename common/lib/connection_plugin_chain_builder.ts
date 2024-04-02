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

import { IamAuthenticationPluginFactory } from "./authentication/iam_authentication_plugin";
import { FailoverPluginFactory } from "./plugins/failover/failover_plugin";
import { PluginService } from "./plugin_service";
import { ConnectionPlugin } from "./connection_plugin";
import { WrapperProperties } from "./wrapper_property";
import { AwsWrapperError } from "./utils/aws_wrapper_error";
import { Messages } from "./utils/messages";
import { DefaultPlugin } from "./plugins/default_plugin";
import { ExecutionTimePluginFactory } from './plugins/execution_time_plugin';

export class PluginFactoryInfo {}

type FactoryClass = typeof IamAuthenticationPluginFactory | typeof FailoverPluginFactory;

export class ConnectionPluginChainBuilder {
  static readonly DEFAULT_PLUGINS = "failover";
  static readonly WEIGHT_RELATIVE_TO_PRIOR_PLUGIN = -1;

  static readonly PLUGIN_FACTORIES = new Map<string, FactoryClass>([
    ["iam", IamAuthenticationPluginFactory],
    ["failover", FailoverPluginFactory],
    ["executionTime", ExecutionTimePluginFactory]
  ]);

  getPlugins(pluginService: PluginService, props: Map<string, any>): ConnectionPlugin[] {
    const plugins: ConnectionPlugin[] = [];
    let pluginCodes: string = props.get(WrapperProperties.PLUGINS.name);
    if (pluginCodes === null || pluginCodes === undefined) {
      pluginCodes = ConnectionPluginChainBuilder.DEFAULT_PLUGINS;
    }

    pluginCodes = pluginCodes.trim();

    if (pluginCodes !== "") {
      const pluginCodeList = pluginCodes.split(",");
      const pluginFactories: FactoryClass[] = [];
      pluginCodeList.forEach((p) => {
        if (!ConnectionPluginChainBuilder.PLUGIN_FACTORIES.has(p)) {
          throw new AwsWrapperError(Messages.get("PluginManager.unknownPluginCode", p));
        }
        const factory = ConnectionPluginChainBuilder.PLUGIN_FACTORIES.get(p);
        if (factory) {
          pluginFactories.push(factory);
        }
      });

      pluginFactories.forEach((factory) => {
        const factoryObj = new factory();
        plugins.push(factoryObj.getInstance(pluginService, props));
      });
    }

    plugins.push(new DefaultPlugin());

    return plugins;
  }
}
