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

import { ClientWrapper } from "../client_wrapper";
import { AwsPoolConfig } from "../aws_pool_config";
import { AwsPoolClient } from "../aws_pool_client";
import { HostInfo } from "../host_info";

export interface DriverDialect {
  getDialectName(): string;

  connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper>;

  preparePoolClientProperties(props: Map<string, any>, poolConfig: AwsPoolConfig | undefined): any;

  getAwsPoolClient(props: any): AwsPoolClient;

  setConnectTimeout(props: Map<string, any>, wrapperConnectTimeout?: any): void;

  setQueryTimeout(props: Map<string, any>, sql?: any, wrapperConnectTimeout?: any): void;

  setKeepAliveProperties(props: Map<string, any>, keepAliveProps: any): void;
}
