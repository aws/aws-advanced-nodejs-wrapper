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

import { ClientWrapper } from "./client_wrapper";
import { HostInfo } from "./host_info";

export class PoolClientWrapper implements ClientWrapper {
  readonly client: any;
  readonly hostInfo: HostInfo;
  readonly properties: Map<string, string>;

  constructor(targetClient: any, hostInfo: HostInfo, properties: Map<string, any>) {
    this.client = targetClient;
    this.hostInfo = hostInfo;
    this.properties = properties;
  }

  abort(): Promise<void> {
    return this.end();
  }

  query(sql: any): Promise<any> {
    return this.client?.query(sql);
  }

  async end(): Promise<void> {
    try {
      return this.client?.release();
    } catch (error: any) {
      // Ignore
    }
  }

  rollback(): Promise<void> {
    return this.client?.rollback();
  }
}
