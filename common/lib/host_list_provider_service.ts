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

import { BlockingHostListProvider, HostListProvider } from "./host_list_provider/host_list_provider";
import { HostInfo } from "./host_info";
import { AwsClient } from "./aws_client";
import { DatabaseDialect } from "./database_dialect/database_dialect";
import { HostInfoBuilder } from "./host_info_builder";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { TelemetryFactory } from "./utils/telemetry/telemetry_factory";
import { AllowedAndBlockedHosts } from "./AllowedAndBlockedHosts";

export interface HostListProviderService {
  getHostListProvider(): HostListProvider | null;

  setHostListProvider(hostListProvider: HostListProvider): void;

  isStaticHostListProvider(): boolean;

  setInitialConnectionHostInfo(initialConnectionHostInfo: HostInfo): void;

  getInitialConnectionHostInfo(): HostInfo | null;

  getCurrentClient(): AwsClient;

  getCurrentHostInfo(): HostInfo | null;

  getDialect(): DatabaseDialect;

  getHostInfoBuilder(): HostInfoBuilder;

  getConnectionUrlParser(): ConnectionUrlParser;

  isInTransaction(): boolean;

  setInTransaction(inTransaction: boolean): void;

  isClientValid(targetClient: any): Promise<boolean>;

  getTelemetryFactory(): TelemetryFactory;

  setAllowedAndBlockedHosts(allowedAndBlockedHosts: AllowedAndBlockedHosts): void;

  isBlockingHostListProvider(arg: any): arg is BlockingHostListProvider;
}
