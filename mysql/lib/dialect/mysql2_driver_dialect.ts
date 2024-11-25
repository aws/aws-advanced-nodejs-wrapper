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

export class MySQL2DriverDialect implements DriverDialect {
  static readonly connectTimeoutPropertyName = "connectTimeout";
  static readonly queryTimeoutPropertyName = "timeout";
  protected dialectName: string = this.constructor.name;

  getDialectName(): string {
    return this.dialectName;
  }

  async connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper> {
    this.setupInitialNetworkTimeouts(props);
    const targetClient = await createConnection(WrapperProperties.removeWrapperProperties(props));
    return Promise.resolve(new MySQLClientWrapper(targetClient, hostInfo, props, this));
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

  setupInitialNetworkTimeouts(props: Map<string, any>) {
    this.setConnectTimeout(props);
  }

  setConnectTimeout(props: Map<string, any>) {
    const wrapperConnectTimeout = props.get(WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name);

    if (wrapperConnectTimeout) {
      props.set(MySQL2DriverDialect.connectTimeoutPropertyName, wrapperConnectTimeout);
    }
  }

  setQueryTimeout(props: Map<string, any>, sql?: any) {
    const queryTimeout = props.get(WrapperProperties.WRAPPER_QUERY_TIMEOUT.name);
    if (queryTimeout && !sql[MySQL2DriverDialect.queryTimeoutPropertyName]) {
      sql[MySQL2DriverDialect.queryTimeoutPropertyName] = queryTimeout;
    }
  }
}
