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

export class AwsPoolConfig {
  readonly maxConnections?: number | undefined;
  readonly minConnections?: number | undefined;
  readonly idleTimeoutMillis?: number | undefined;
  readonly connectionTimeoutMillis?: number | undefined;
  readonly allowExitOnIdle?: boolean | undefined;
  readonly maxIdleConnections?: number | undefined;

  constructor(props?: any) {
    this.maxConnections = props.maxConnections ?? 10;
    this.idleTimeoutMillis = props.idleTimeoutMillis ?? 60000;
    this.connectionTimeoutMillis = props.connectionTimeoutMillis ?? 60000;
    this.maxIdleConnections = props.maxIdleConnections ?? 10;
    this.allowExitOnIdle = props.allowExitOnIdle ?? false;
    this.minConnections = props.minConnections ?? 0;
  }
}
