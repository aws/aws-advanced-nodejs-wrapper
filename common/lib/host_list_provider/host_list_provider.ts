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

import { HostInfo } from "../host_info";
import { HostRole } from "../host_role";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { ClientWrapper } from "../client_wrapper";

export type DynamicHostListProvider = HostListProvider;

export type StaticHostListProvider = HostListProvider;

export interface BlockingHostListProvider extends HostListProvider {
  forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]>;

  clearAll(): Promise<void>;
}

export interface HostListProvider {
  refresh(): Promise<HostInfo[]>;

  refresh(client: ClientWrapper): Promise<HostInfo[]>;

  forceRefresh(): Promise<HostInfo[]>;

  forceRefresh(client: ClientWrapper): Promise<HostInfo[]>;

  getHostRole(client: ClientWrapper, dialect: DatabaseDialect): Promise<HostRole>;

  identifyConnection(targetClient: ClientWrapper, dialect: DatabaseDialect): Promise<HostInfo | null>;

  createHost(host: string, isWriter: boolean, weight: number, lastUpdateTime: number, port?: number): HostInfo;

  getHostProviderType(): string;

  getClusterId(): string;
}
