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
import { AwsClient } from "./aws_client";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { HostRole } from "./host_role";

export interface TopologyAwareDatabaseDialect {
  queryForTopology(client: AwsClient, props: Map<string, any>, hostListProvider: HostListProvider): Promise<HostInfo[]>;

  identifyConnection(client: AwsClient, props: Map<string, any>): Promise<string>;

  getHostRole(client: AwsClient, props: Map<string, any>): Promise<HostRole>;
}
