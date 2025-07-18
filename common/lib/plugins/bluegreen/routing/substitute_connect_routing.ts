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

import { BaseConnectRouting } from "./base_connect_routing";
import { ConnectionPlugin } from "../../../connection_plugin";
import { HostInfo } from "../../../host_info";
import { ClientWrapper } from "../../../client_wrapper";
import { PluginService } from "../../../plugin_service";
import { RdsUtils } from "../../../utils/rds_utils";
import { BlueGreenRole } from "../blue_green_role";
import { AwsWrapperError } from "../../../utils/errors";
import { Messages } from "../../../utils/messages";
import { HostAvailability } from "../../../host_availability/host_availability";
import { WrapperProperties } from "../../../wrapper_property";

export interface IamSuccessfulConnectFunc {
  notify(iamHost: string): void;
}

export class SubstituteConnectRouting extends BaseConnectRouting {
  protected readonly rdsUtils: RdsUtils;
  protected readonly substituteHost: HostInfo;
  protected readonly iamHosts: HostInfo[];
  protected readonly iamSuccessfulConnectNotify: IamSuccessfulConnectFunc;

  constructor(
    hostAndPort: string,
    role: BlueGreenRole,
    substituteHost: HostInfo,
    iamHosts: HostInfo[],
    iamSuccessfulConnectNotify: IamSuccessfulConnectFunc
  ) {
    super(hostAndPort, role);
    this.substituteHost = substituteHost;
    this.iamHosts = iamHosts;
    this.iamSuccessfulConnectNotify = iamSuccessfulConnectNotify;
    this.rdsUtils = new RdsUtils();
  }

  async apply(
    plugin: ConnectionPlugin,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>,
    pluginService: PluginService
  ): Promise<ClientWrapper> {
    if (!this.rdsUtils.isIP(this.substituteHost.host)) {
      return pluginService.connect(this.substituteHost, properties, plugin);
    }

    if (!this.iamHosts || this.iamHosts.length === 0) {
      throw new AwsWrapperError(Messages.get("Bgd.requireIamHost"));
    }

    for (const iamHost of this.iamHosts) {
      const reroutedHostInfo: HostInfo = pluginService
        .getHostInfoBuilder()
        .copyFrom(this.substituteHost)
        .withHostId(iamHost.hostId)
        .withAvailability(HostAvailability.AVAILABLE)
        .build();
      reroutedHostInfo.addAlias(iamHost.host);

      const reroutedProperties: Map<string, any> = new Map<string, any>(properties);
      reroutedProperties.set(WrapperProperties.HOST.name, iamHost.host);
      if (iamHost.isPortSpecified()) {
        reroutedProperties.set(WrapperProperties.IAM_DEFAULT_PORT.name, iamHost.port);
      }

      try {
        const conn: ClientWrapper = await pluginService.connect(reroutedHostInfo, reroutedProperties);
        if (!this.iamSuccessfulConnectNotify) {
          try {
            this.iamSuccessfulConnectNotify.notify(iamHost.host);
          } catch (e: any) {
            // do nothing
          }
        }
        return conn;
      } catch (e: any) {
        if (!pluginService.isLoginError(e)) {
          throw e;
        }
        // do nothing
        // try with another IAM host
      }
    }
    throw new AwsWrapperError(Messages.get("Bgd.inProgressCantOpenConnection", this.substituteHost.getHostAndPort()));
  }

  toString(): string {
    return `${this.constructor.name} [${this.hostAndPort ?? "<null>"}, ${this.role?.name ?? "<null>"}, substitute: ${this.substituteHost?.getHostAndPort() ?? "<null>"}, iamHosts: ${
      this.iamHosts?.map((host) => host.getHostAndPort()).join(", ") ?? "<null>"
    }]`;
  }
}
