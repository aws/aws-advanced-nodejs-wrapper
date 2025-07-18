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

import { BaseRouting } from "./base_routing";
import { BlueGreenRole } from "../blue_green_role";
import { HostInfo } from "../../../host_info";
import { PluginService } from "../../../plugin_service";
import { ExecuteRouting, RoutingResultHolder } from "./execute_routing";
import { ConnectionPlugin } from "../../../connection_plugin";

export abstract class BaseExecuteRouting extends BaseRouting implements ExecuteRouting {
  isMatch(hostInfo: HostInfo, hostRole: BlueGreenRole): boolean {
    return (
      (this.hostAndPort === null || this.hostAndPort === (hostInfo ?? hostInfo.getHostAndPort().toLowerCase())) &&
      (this.role === null || this.role === hostRole)
    );
  }

  abstract apply<T>(
    plugin: ConnectionPlugin,
    methodName: string,
    methodFunc: () => Promise<T>,
    methodArgs: any,
    properties: Map<string, any>,
    pluginService: PluginService
  ): Promise<RoutingResultHolder<T>>;
}
