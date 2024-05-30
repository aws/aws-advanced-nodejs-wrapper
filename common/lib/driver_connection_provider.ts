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

import { ConnectionProvider } from "./connection_provider";
import { HostRole } from "./host_role";
import { HostInfo } from "./host_info";
import { HostSelector } from "./host_selector";
import { RandomHostSelector } from "./random_host_selector";
import { AwsWrapperError } from "./utils/errors";
import { WrapperProperties } from "./wrapper_property";
import { Messages } from "./utils/messages";
import { RdsUtils } from "./utils/rds_utils";
import { HostInfoBuilder } from "./host_info_builder";
import { promisify } from "util";
import { lookup } from "dns";
import { PluginService } from "./plugin_service";
import { logger } from "../logutils";
import { maskProperties } from "./utils/utils";

export class DriverConnectionProvider implements ConnectionProvider {
  private static readonly acceptedStrategies: Map<string, HostSelector> = new Map([[RandomHostSelector.STRATEGY_NAME, new RandomHostSelector()]]);
  private readonly rdsUtils: RdsUtils = new RdsUtils();

  acceptsStrategy(role: HostRole, strategy: string): boolean {
    return DriverConnectionProvider.acceptedStrategies.has(strategy);
  }

  acceptsUrl(hostInfo: HostInfo, props: Map<string, any>): boolean {
    return true;
  }

  async connect<T>(hostInfo: HostInfo, pluginService: PluginService, props: Map<string, any>, connectFunc: () => Promise<T>): Promise<T> {
    let result;
    try {
      result = await connectFunc();
    } catch (e) {
      if (!WrapperProperties.ENABLE_GREEN_NODE_REPLACEMENT.get(props)) {
        throw e;
      }

      // if (!JSON.stringify(e).includes("Error: getaddrinfo ENOTFOUND")) {
      //   throw e;
      // }

      if (!this.rdsUtils.isRdsDns(hostInfo.host) || !this.rdsUtils.isGreenInstance(hostInfo.host)) {
        throw e;
      }

      // check DNS for green host name
      let resolvedAddress;
      try {
        resolvedAddress = await promisify(lookup)(hostInfo.host, {});
      } catch (tmp) {
        // do nothing
      }

      if (resolvedAddress) {
        // Green node DNS exists
        throw e;
      }

      // Green node DNS doesn't exist. Try to replace it with corresponding node name and connect again.
      const originalHost: string = hostInfo.host;
      const fixedHost: string = this.rdsUtils.removeGreenInstancePrefix(hostInfo.host);
      props.set(WrapperProperties.HOST.name, fixedHost);
      const connectionHostInfo = new HostInfoBuilder({
        hostAvailabilityStrategy: hostInfo.hostAvailabilityStrategy
      })
        .copyFrom(hostInfo)
        .withHost(fixedHost)
        .build();

      logger.info(
        "Connecting to " +
          fixedHost +
          " after correcting the hostname from " +
          originalHost +
          "\nwith properties: \n" +
          JSON.stringify(maskProperties(props))
      );

      await pluginService.tryClosingTargetClient();
      const newTargetClient = pluginService.createTargetClient(props);
      const fixedConnFunc = pluginService.getConnectFunc(newTargetClient);
      result = await fixedConnFunc();
      await pluginService.setCurrentClient(newTargetClient, connectionHostInfo);
    }

    return result;
  }

  getHostInfoByStrategy(hosts: HostInfo[], role: HostRole, strategy: string, props?: Map<string, any>): HostInfo {
    const acceptedStrategy = DriverConnectionProvider.acceptedStrategies.get(strategy);
    if (!acceptedStrategy) {
      throw new AwsWrapperError(Messages.get("ConnectionProvider.unsupportedHostInfoSelectorStrategy", strategy, "DriverConnectionProvider"));
    }
    return acceptedStrategy.getHost(hosts, role, props);
  }
}
