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

import { HostRole } from "./host_role";
import { HostInfo } from "./host_info";
import { PluginService } from "./plugin_service";
import { ConnectionInfo } from "./connection_info";
import { ClientWrapper } from "./client_wrapper";

export interface ConnectionProvider {
  connect(hostInfo: HostInfo, pluginService: PluginService, props: Map<string, any>): Promise<ConnectionInfo>;
  acceptsUrl(hostInfo: HostInfo, props: Map<string, any>): boolean;
  acceptsStrategy(role: HostRole, strategy: string): boolean;
  getHostInfoByStrategy(hosts: HostInfo[], role: HostRole, strategy: string, props?: Map<string, any>): HostInfo;

  /**
   * Marks a client returned by {@link connect} so that ending it closes its physical connection instead of returning
   * it to this provider's internal pool. Call it before ending the client, because another caller can take a released
   * connection at once. Providers without an internal pool do not implement this method.
   *
   * @returns true if the client belongs to this provider's pool and is still checked out, otherwise false.
   */
  evictClient?(client: ClientWrapper): boolean;
}
