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

import { ClientWrapper } from "../../common/lib/client_wrapper";
import { Pool, PoolClient, PoolConfig } from "pg";
import { AwsPoolClient } from "../../common/lib/aws_pool_client";
import { Messages } from "../../common/lib/utils/messages";
import { AwsWrapperError } from "../../common/lib/utils/errors";

export class AwsPgPoolClient implements AwsPoolClient {
  targetClient?: ClientWrapper;
  targetPool: Pool;

  constructor(props: PoolConfig) {
    this.targetPool = new Pool(props);
    this.targetPool.on("connect", (_client: PoolClient) => {
      _client.on("error", (err: Error) => {
        console.log(err);
      });
    });
  }

  async connect(): Promise<any> {
    try {
      return await this.targetPool.connect();
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("InternalPooledConnectionProvider.pooledConnectionFailed", error.message));
    }
  }

  async end(poolClient: any) {
    if (poolClient == undefined) {
      return;
    }
    await poolClient.release(true);
  }

  getIdleCount(): number {
    return this.targetPool.idleCount;
  }

  getTotalCount(): number {
    return this.targetPool.totalCount;
  }

  async releaseResources() {
    await this.targetPool.end();
  }
}
