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

import pkgPg from "pg";

import { AwsPoolClient } from "../../common/lib/aws_pool_client";
import { Messages } from "../../common/lib/utils/messages";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { logger } from "../../common/logutils";

export class AwsPgPoolClient implements AwsPoolClient {
  targetPool: pkgPg.Pool;

  constructor(props: pkgPg.PoolConfig) {
    this.targetPool = new pkgPg.Pool(props);
    this.targetPool.on("connect", (_client: pkgPg.PoolClient) => {
      _client.on("error", (err: Error) => {
        logger.debug(err);
      });
    });
  }

  async end(): Promise<any> {
    try {
      return await this.targetPool.end();
    } catch (error: any) {
      // Ignore
    }
  }

  async connect(): Promise<any> {
    try {
      return await this.targetPool.connect();
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("InternalPooledConnectionProvider.pooledConnectionFailed", error.message));
    }
  }

  getIdleCount(): number {
    return this.targetPool.idleCount;
  }

  getTotalCount(): number {
    return this.targetPool.totalCount;
  }

  getActiveCount(): number {
    return this.getTotalCount() - this.getIdleCount();
  }

  async releaseResources(): Promise<void> {
    await this.targetPool.end();
  }
}
