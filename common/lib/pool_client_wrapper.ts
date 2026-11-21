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
import { logger, uniqueId } from "../logutils";
import { ClientUtils } from "./utils/client_utils";
import { SessionState } from "./session_state";
import { AwsInternalPoolClient } from "./aws_pool_client";
import { Messages } from "./utils/messages";

export class PoolClientWrapper implements ClientWrapper {
  readonly client: any;
  readonly hostInfo: HostInfo;
  readonly properties: Map<string, string>;
  readonly id: string;
  readonly sessionState = new SessionState();
  private readonly pool?: AwsInternalPoolClient;
  private released = false;
  private evictOnEnd = false;

  constructor(targetClient: any, hostInfo: HostInfo, properties: Map<string, any>, pool?: AwsInternalPoolClient) {
    this.client = targetClient;
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.id = uniqueId("PoolClient_");
    this.pool = pool;
  }

  /**
   * Makes {@link end} close the physical connection and remove it from the pool instead of releasing it.
   *
   * @returns false if the client was already released or has no pool to remove it from.
   */
  markForEviction(): boolean {
    if (this.released || !this.pool) {
      return false;
    }
    this.evictOnEnd = true;
    return true;
  }

  abort(): Promise<void> {
    return this.end();
  }

  query(sql: string): Promise<any>;
  query(config: any, values?: any): Promise<any> {
    return this.client?.query(config, values);
  }

  async queryWithTimeout(sql: string): Promise<any> {
    return await ClientUtils.queryWithTimeout(this.client.query(sql), this.properties);
  }

  async end(): Promise<void> {
    // After release the pool may already have handed the same connection to another caller.
    if (this.released) {
      return;
    }
    this.released = true;
    try {
      if (this.evictOnEnd && this.pool) {
        this.pool.discardClient(this.client);
        logger.debug(Messages.get("PoolClientWrapper.evicted", this.hostInfo?.hostAndPort ?? "<null>"));
        return;
      }
      return this.client?.release();
    } catch (error: any) {
      // Ignore
    }
  }

  rollback(): Promise<void> {
    return this.client?.rollback();
  }
}
