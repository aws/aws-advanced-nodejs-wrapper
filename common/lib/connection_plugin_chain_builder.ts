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
import { AwsWrapperError } from "./utils/errors";
import { Messages } from "./utils/messages";
import { DefaultPlugin } from "./plugins/default_plugin";
import { ExecuteTimePluginFactory } from "./plugins/execute_time_plugin";
import { ConnectTimePluginFactory } from "./plugins/connect_time_plugin";
import { AwsSecretsManagerPluginFactory } from "./authentication/aws_secrets_manager_plugin";
import { ConnectionProvider } from "./connection_provider";
import { ReadWriteSplittingPluginFactory } from "./plugins/read_write_splitting";
import { StaleDnsPluginFactory } from "./plugins/stale_dns/stale_dns_plugin";
import { FederatedAuthPluginFactory } from "./plugins/federated_auth/federated_auth_plugin";
import { logger } from "../logutils";
import { OktaAuthPluginFactory } from "./plugins/federated_auth/okta_auth_plugin_factory";

/*
  Type alias used for plugin factory sorting. It holds a reference to a plugin
  factory and an assigned weight.
*/
type PluginFactoryInfo = {
  factory: FactoryClass;
  weight: number;
};

type FactoryClass = typeof IamAuthenticationPluginFactory | typeof FailoverPluginFactory;

export class ConnectionPluginChainBuilder {
  static readonly DEFAULT_PLUGINS = "failover";
  static readonly WEIGHT_RELATIVE_TO_PRIOR_PLUGIN = -1;

  static readonly PLUGIN_FACTORIES = new Map<string, PluginFactoryInfo>([
    ["staleDns", { factory: StaleDnsPluginFactory, weight: 500 }],
    ["readWriteSplitting", { factory: ReadWriteSplittingPluginFactory, weight: 600 }],
    ["failover", { factory: FailoverPluginFactory, weight: 700 }],
    ["iam", { factory: IamAuthenticationPluginFactory, weight: 1000 }],
    ["secretsManager", { factory: AwsSecretsManagerPluginFactory, weight: 1100 }],
    ["federatedAuth", { factory: FederatedAuthPluginFactory, weight: 1200 }],
    ["okta", { factory: OktaAuthPluginFactory, weight: 1200 }],
    ["connectTime", { factory: ConnectTimePluginFactory, weight: ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN }],
    ["executeTime", { factory: ExecuteTimePluginFactory, weight: ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN }]
  ]);

  getPlugins(
    pluginService: PluginService,
    props: Map<string, any>,
    defaultConnProvider: ConnectionProvider,
    effectiveConnProvider: ConnectionProvider | null
  ): ConnectionPlugin[] {
    const plugins: ConnectionPlugin[] = [];
    let pluginCodes: string = props.get(WrapperProperties.PLUGINS.name);
    if (pluginCodes == null) {
      pluginCodes = ConnectionPluginChainBuilder.DEFAULT_PLUGINS;
    }

    const usingDefault = pluginCodes === ConnectionPluginChainBuilder.DEFAULT_PLUGINS;

    pluginCodes = pluginCodes.trim();

    if (pluginCodes !== "") {
      const pluginCodeList = pluginCodes.split(",").map((pluginCode) => pluginCode.trim());
      let pluginFactoryInfoList: PluginFactoryInfo[] = [];
      let lastWeight = 0;
      pluginCodeList.forEach((p) => {
        if (!ConnectionPluginChainBuilder.PLUGIN_FACTORIES.has(p)) {
          throw new AwsWrapperError(Messages.get("PluginManager.unknownPluginCode", p));
        }

        const factoryInfo = ConnectionPluginChainBuilder.PLUGIN_FACTORIES.get(p);
        if (factoryInfo) {
          if (factoryInfo.weight === ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN) {
            factoryInfo.weight = ++lastWeight;
          } else {
            lastWeight = factoryInfo.weight;
          }
          pluginFactoryInfoList.push(factoryInfo);
        }
      });

      if (!usingDefault && pluginFactoryInfoList.length > 1 && WrapperProperties.AUTO_SORT_PLUGIN_ORDER.get(props)) {
        pluginFactoryInfoList = pluginFactoryInfoList.sort((a, b) => a.weight - b.weight);

        if (!usingDefault) {
          logger.info(
            "Plugins order has been rearranged. The following order is in effect: " +
              pluginFactoryInfoList.map((pluginFactoryInfo) => pluginFactoryInfo.factory.name.split("Factory")[0]).join(", ")
          );
        }
      }

      pluginFactoryInfoList.forEach((pluginFactoryInfo) => {
        const factoryObj = new pluginFactoryInfo.factory();
        plugins.push(factoryObj.getInstance(pluginService, props));
      });
    }

    plugins.push(new DefaultPlugin(pluginService, defaultConnProvider, effectiveConnProvider));

    return plugins;
  }
}
