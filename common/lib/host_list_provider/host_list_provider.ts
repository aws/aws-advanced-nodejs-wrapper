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

import { AwsClient } from "../aws_client";
import { HostInfo } from "../host_info";
import { HostRole } from "../host_role";

export interface DynamicHostListProvider extends HostListProvider {}

export interface StaticHostListProvider extends HostListProvider {}

export interface HostListProvider {
  refresh(): Promise<HostInfo[]>;

  refresh(client: AwsClient): Promise<HostInfo[]>;

  forceRefresh(): Promise<HostInfo[]>;

  forceRefresh(client: AwsClient): Promise<HostInfo[]>;

  getHostRole(client: AwsClient): Promise<HostRole>;

  identifyConnection(client: AwsClient): Promise<HostInfo | void | null>;

  createHost(host: string, isWriter: boolean, weight: number, lastUpdateTime: number): HostInfo;
}
