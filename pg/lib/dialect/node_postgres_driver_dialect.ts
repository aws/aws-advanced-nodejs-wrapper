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

import { DriverDialect } from "../../../common/lib/driver_dialect/driver_dialect";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { Client, PoolConfig } from "pg";
import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { AwsPoolConfig } from "../../../common/lib/aws_pool_config";
import { AwsPoolClient } from "../../../common/lib/aws_pool_client";
import { AwsPgPoolClient } from "../pg_pool_client";

export class NodePostgresDriverDialect implements DriverDialect {
  protected dialectName: string = this.constructor.name;

  getDialectName(): string {
    return this.dialectName;
  }

  async connect(props: Map<string, any>): Promise<any> {
    const targetClient = new Client(WrapperProperties.removeWrapperProperties(props));
    await targetClient.connect();
    return targetClient;
  }

  async rollback(targetClient: ClientWrapper): Promise<any> {
    return await targetClient.client.rollback();
  }

  end(targetClient: ClientWrapper): Promise<void> {
    return targetClient.client.end();
  }

  async abort(targetClient: ClientWrapper) {
    await targetClient.client.end().catch((error: any) => {
      // ignore
    });
  }

  preparePoolClientProperties(props: Map<string, any>, poolConfig: AwsPoolConfig | undefined): any {
    const finalPoolConfig: PoolConfig = {};
    const finalClientProps = WrapperProperties.removeWrapperProperties(props);

    Object.assign(finalPoolConfig, finalClientProps);
    finalPoolConfig.max = poolConfig?.maxConnections;
    finalPoolConfig.min = poolConfig?.minConnections;
    finalPoolConfig.idleTimeoutMillis = poolConfig?.idleTimeoutMillis;
    finalPoolConfig.allowExitOnIdle = poolConfig?.allowExitOnIdle;
    return finalPoolConfig;
  }

  getAwsPoolClient(props: PoolConfig): AwsPoolClient {
    return new AwsPgPoolClient(props);
  }
}
