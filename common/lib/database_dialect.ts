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

import { AwsClient } from "./aws_client";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { HostListProviderService } from "./host_list_provider_service";

export interface DatabaseDialect {
  getConnectFunc(newTargetClient: AwsClient): () => Promise<any>;
  tryClosingTargetClient(targetClient: any): Promise<void>;
  isClientValid(targetClient: any): Promise<boolean>;
  getDefaultPort(): number;
  getHostAliasQuery(): string;
  getHostAliasAndParseResults(client: AwsClient): Promise<string>;
  getServerVersionQuery(): string;
  getDialectUpdateCandidates(): string[];
  isDialect<T>(conn: T): boolean;
  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider;
}
