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

import { HostInfo } from "./host_info";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { HostRole } from "./host_role";
import { ClientWrapper } from "./client_wrapper";

export interface TopologyAwareDatabaseDialect {
  queryForTopology(client: ClientWrapper, hostListProvider: HostListProvider): Promise<HostInfo[]>;

  identifyConnection(targetClient: ClientWrapper): Promise<string>;

  getHostRole(client: ClientWrapper): Promise<HostRole>;

  // Returns the host id of the targetClient if it is connected to a writer, null otherwise.
  getWriterId(targetClient: ClientWrapper): Promise<string | null>;
}
