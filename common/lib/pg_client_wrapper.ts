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
import { uniqueId } from "../logutils";
import { QueryResult } from "pg";

/*
This an internal wrapper class for a target community driver client created by the NodePostgresPgDriverDialect.
 */
export class PgClientWrapper implements ClientWrapper {
  readonly client: any;
  readonly hostInfo: HostInfo;
  readonly properties: Map<string, string>;
  readonly id: string;

  /**
   * Creates a wrapper for the target community driver client.
   *
   * @param targetClient The community driver client created for an instance.
   * @param hostInfo Host information for the connected instance.
   * @param properties Connection properties for the target client.
   */
  constructor(targetClient: any, hostInfo: HostInfo, properties: Map<string, any>) {
    this.client = targetClient;
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.id = uniqueId("PgClient_");
  }

  query(sql: any): Promise<any> {
    return this.client?.query(sql);
  }

  queryWithTimeout(sql: string): Promise<QueryResult> {
    return this.client?.queryWithTimeout(this.client.query(sql), this.properties);
  }

  end(): Promise<void> {
    return this.client?.end();
  }

  rollback(): Promise<void> {
    return this.client?.rollback();
  }

  async abort(): Promise<void> {
    try {
      return await this.end();
    } catch (error: any) {
      // Ignore
    }
  }
}
