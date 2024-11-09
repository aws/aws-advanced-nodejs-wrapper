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
import { createConnection, PoolOptions } from "mysql2/promise";
import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { AwsPoolConfig } from "../../../common/lib/aws_pool_config";
import { AwsPoolClient } from "../../../common/lib/aws_pool_client";
import { AwsMysqlPoolClient } from "../mysql_pool_client";
import { MySQLClientWrapper } from "../../../common/lib/mysql_client_wrapper";
import { HostInfo } from "../../../common/lib/host_info";
import { logger } from "../../../common/logutils";

export class MySQL2DriverDialect implements DriverDialect {
  protected dialectName: string = this.constructor.name;

  getDialectName(): string {
    return this.dialectName;
  }

  async connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper> {
    try {
      logger.info("props: " + JSON.stringify(Object.fromEntries(props.entries()), null, 2));
      const config = WrapperProperties.removeWrapperProperties(props);
      logger.info("config: " + JSON.stringify(config, null, 2));
      const targetClient = await createConnection(config);
      return new MySQLClientWrapper(targetClient, hostInfo, props);
    } catch (e) {
      logger.error(e);
      throw e;
    }
  }

  preparePoolClientProperties(props: Map<string, any>, poolConfig: AwsPoolConfig | undefined): any {
    const finalPoolConfig: PoolOptions = {};
    const finalClientProps = WrapperProperties.removeWrapperProperties(props);

    Object.assign(finalPoolConfig, finalClientProps);
    finalPoolConfig.connectionLimit = poolConfig?.maxConnections;
    finalPoolConfig.idleTimeout = poolConfig?.idleTimeoutMillis;
    finalPoolConfig.maxIdle = poolConfig?.maxIdleConnections;
    finalPoolConfig.waitForConnections = poolConfig?.waitForConnections;
    finalPoolConfig.queueLimit = poolConfig?.queueLimit;
    return finalPoolConfig;
  }

  getAwsPoolClient(props: PoolOptions): AwsPoolClient {
    return new AwsMysqlPoolClient(props);
  }
}
