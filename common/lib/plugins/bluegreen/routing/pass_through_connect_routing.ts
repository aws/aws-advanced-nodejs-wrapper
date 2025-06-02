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

// Pass through connect call without additional routing.
export class PassThroughConnectRouting extends BaseConnectRouting {
  apply(
    plugin: ConnectionPlugin,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>,
    pluginService: PluginService
  ): Promise<ClientWrapper> {
    return connectFunc();
  }
}
