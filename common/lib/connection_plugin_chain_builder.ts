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

import { PluginService } from "./plugin_service";
import { ConnectionPlugin } from "./connection_plugin";
import { WrapperProperties } from "./wrapper_property";
import { AwsWrapperError } from "./utils/errors";
import { Messages } from "./utils/messages";
import { logger } from "../logutils";
import { DefaultPlugin } from "./plugins/default_plugin";
import { IamAuthenticationPluginFactory } from "./authentication/iam_authentication_plugin_factory";
import { ExecuteTimePluginFactory } from "./plugins/execute_time_plugin_factory";
import { ConnectTimePluginFactory } from "./plugins/connect_time_plugin_factory";
import { AwsSecretsManagerPluginFactory } from "./authentication/aws_secrets_manager_plugin_factory";
import { FailoverPluginFactory } from "./plugins/failover/failover_plugin_factory";
import { Failover2PluginFactory } from "./plugins/failover2/failover2_plugin_factory";
import { StaleDnsPluginFactory } from "./plugins/stale_dns/stale_dns_plugin_factory";
import { FederatedAuthPluginFactory } from "./plugins/federated_auth/federated_auth_plugin_factory";
import { ReadWriteSplittingPluginFactory } from "./plugins/read_write_splitting/read_write_splitting_plugin_factory";
import { OktaAuthPluginFactory } from "./plugins/federated_auth/okta_auth_plugin_factory";
import { HostMonitoringPluginFactory } from "./plugins/efm/host_monitoring_plugin_factory";
import { AuroraInitialConnectionStrategyFactory } from "./plugins/aurora_initial_connection_strategy_plugin_factory";
import { AuroraConnectionTrackerPluginFactory } from "./plugins/connection_tracker/aurora_connection_tracker_plugin_factory";
import { ConnectionProviderManager } from "./connection_provider_manager";
import { DeveloperConnectionPluginFactory } from "./plugins/dev/developer_connection_plugin_factory";
import { ConnectionPluginFactory } from "./plugin_factory";
import { LimitlessConnectionPluginFactory } from "./plugins/limitless/limitless_connection_plugin_factory";
import { FastestResponseStrategyPluginFactory } from "./plugins/strategy/fastest_response/fastest_respose_strategy_plugin_factory";
import { CustomEndpointPluginFactory } from "./plugins/custom_endpoint/custom_endpoint_plugin_factory";
import { ConfigurationProfile } from "./profile/configuration_profile";
import { HostMonitoring2PluginFactory } from "./plugins/efm2/host_monitoring2_plugin_factory";
import { BlueGreenPluginFactory } from "./plugins/bluegreen/blue_green_plugin_factory";

/*
  Type alias used for plugin factory sorting. It holds a reference to a plugin
  factory and an assigned weight.
*/
type PluginFactoryInfo = {
  factory: typeof ConnectionPluginFactory;
  weight: number;
};

export class ConnectionPluginChainBuilder {
  static readonly WEIGHT_RELATIVE_TO_PRIOR_PLUGIN = -1;

  static readonly PLUGIN_FACTORIES = new Map<string, PluginFactoryInfo>([
    ["customEndpoint", { factory: CustomEndpointPluginFactory, weight: 380 }],
    ["initialConnection", { factory: AuroraInitialConnectionStrategyFactory, weight: 390 }],
    ["auroraConnectionTracker", { factory: AuroraConnectionTrackerPluginFactory, weight: 400 }],
    ["staleDns", { factory: StaleDnsPluginFactory, weight: 500 }],
    ["bg", { factory: BlueGreenPluginFactory, weight: 550 }],
    ["readWriteSplitting", { factory: ReadWriteSplittingPluginFactory, weight: 600 }],
    ["failover", { factory: FailoverPluginFactory, weight: 700 }],
    ["failover2", { factory: Failover2PluginFactory, weight: 710 }],
    ["efm", { factory: HostMonitoringPluginFactory, weight: 800 }],
    ["efm2", { factory: HostMonitoring2PluginFactory, weight: 810 }],
    ["fastestResponseStrategy", { factory: FastestResponseStrategyPluginFactory, weight: 900 }],
    ["limitless", { factory: LimitlessConnectionPluginFactory, weight: 950 }],
    ["iam", { factory: IamAuthenticationPluginFactory, weight: 1000 }],
    ["secretsManager", { factory: AwsSecretsManagerPluginFactory, weight: 1100 }],
    ["federatedAuth", { factory: FederatedAuthPluginFactory, weight: 1200 }],
    ["okta", { factory: OktaAuthPluginFactory, weight: 1300 }],
    ["dev", { factory: DeveloperConnectionPluginFactory, weight: 1400 }],
    ["connectTime", { factory: ConnectTimePluginFactory, weight: ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN }],
    ["executeTime", { factory: ExecuteTimePluginFactory, weight: ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN }]
  ]);

  static readonly PLUGIN_WEIGHTS = new Map<typeof ConnectionPluginFactory, number>([
    [AuroraInitialConnectionStrategyFactory, 390],
    [AuroraConnectionTrackerPluginFactory, 400],
    [StaleDnsPluginFactory, 500],
    [BlueGreenPluginFactory, 550],
    [ReadWriteSplittingPluginFactory, 600],
    [FailoverPluginFactory, 700],
    [Failover2PluginFactory, 710],
    [HostMonitoringPluginFactory, 800],
    [HostMonitoring2PluginFactory, 810],
    [LimitlessConnectionPluginFactory, 950],
    [IamAuthenticationPluginFactory, 1000],
    [AwsSecretsManagerPluginFactory, 1100],
    [FederatedAuthPluginFactory, 1200],
    [OktaAuthPluginFactory, 1300],
    [DeveloperConnectionPluginFactory, 1400],
    [ConnectTimePluginFactory, ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN],
    [ExecuteTimePluginFactory, ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN]
  ]);

  static async getPlugins(
    pluginService: PluginService,
    props: Map<string, any>,
    connectionProviderManager: ConnectionProviderManager,
    configurationProfile: ConfigurationProfile | null
  ): Promise<ConnectionPlugin[]> {
    let pluginFactoryInfoList: PluginFactoryInfo[] = [];
    const plugins: ConnectionPlugin[] = [];
    let usingDefault: boolean = false;

    if (configurationProfile) {
      const profilePluginFactories = configurationProfile.getPluginFactories();
      if (profilePluginFactories) {
        for (const factory of profilePluginFactories) {
          const weight = ConnectionPluginChainBuilder.PLUGIN_WEIGHTS.get(factory);
          if (!weight) {
            throw new AwsWrapperError(Messages.get("PluginManager.unknownPluginWeight", factory.prototype.constructor.name));
          }
          pluginFactoryInfoList.push({ factory: factory, weight: weight });
        }
        usingDefault = true; // We assume that plugin factories in configuration profile is presorted.
      }
    } else {
      let pluginCodes: string = props.get(WrapperProperties.PLUGINS.name);
      if (pluginCodes == null) {
        pluginCodes = WrapperProperties.DEFAULT_PLUGINS;
      }
      usingDefault = pluginCodes === WrapperProperties.DEFAULT_PLUGINS;

      pluginCodes = pluginCodes.trim();
      if (pluginCodes !== "") {
        const pluginCodeList = pluginCodes.split(",").map((pluginCode) => pluginCode.trim());
        let lastWeight = 0;
        pluginCodeList.forEach((p) => {
          if (!ConnectionPluginChainBuilder.PLUGIN_FACTORIES.has(p)) {
            throw new AwsWrapperError(Messages.get("PluginManager.unknownPluginCode", p));
          }

          const factoryInfo = ConnectionPluginChainBuilder.PLUGIN_FACTORIES.get(p);
          if (factoryInfo) {
            if (factoryInfo.weight === ConnectionPluginChainBuilder.WEIGHT_RELATIVE_TO_PRIOR_PLUGIN) {
              lastWeight++;
            } else {
              lastWeight = factoryInfo.weight;
            }
            pluginFactoryInfoList.push({ factory: factoryInfo.factory, weight: lastWeight });
          }
        });
      }
    }

    if (!usingDefault && pluginFactoryInfoList.length > 1 && WrapperProperties.AUTO_SORT_PLUGIN_ORDER.get(props)) {
      pluginFactoryInfoList = pluginFactoryInfoList.sort((a, b) => a.weight - b.weight);

      if (!usingDefault) {
        logger.info(
          "Plugins order has been rearranged. The following order is in effect: " +
            pluginFactoryInfoList.map((pluginFactoryInfo) => pluginFactoryInfo.factory.name.split("Factory")[0]).join(", ")
        );
      }
    }

    for (const pluginFactoryInfo of pluginFactoryInfoList) {
      const factoryObj = new pluginFactoryInfo.factory();
      plugins.push(await factoryObj.getInstance(pluginService, props));
    }

    plugins.push(new DefaultPlugin(pluginService, connectionProviderManager));

    return plugins;
  }
}
