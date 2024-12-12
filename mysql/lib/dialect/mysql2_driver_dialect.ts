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
import { UnsupportedMethodError } from "../../../common/lib/utils/errors";

export class MySQL2DriverDialect implements DriverDialect {
  protected dialectName: string = this.constructor.name;
  private static readonly CONNECT_TIMEOUT_PROPERTY_NAME = "connectTimeout";
  private static readonly QUERY_TIMEOUT_PROPERTY_NAME = "timeout";
  private static readonly KEEP_ALIVE_PROPERTY_NAME = "keepAlive";

  getDialectName(): string {
    return this.dialectName;
  }

  async connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper> {
    const driverProperties = WrapperProperties.removeWrapperProperties(props);
    // MySQL2 does not support keep alive, explicitly check and throw an exception if this value is set to true.
    this.setKeepAliveProperties(driverProperties, props.get(WrapperProperties.KEEPALIVE_PROPERTIES.name));
    this.setConnectTimeout(driverProperties, props.get(WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name));
    const targetClient = await createConnection(Object.fromEntries(driverProperties.entries()));
    return Promise.resolve(new MySQLClientWrapper(targetClient, hostInfo, props, this));
  }

  preparePoolClientProperties(props: Map<string, any>, poolConfig: AwsPoolConfig | undefined): any {
    const finalPoolConfig: PoolOptions = {};
    const finalClientProps = WrapperProperties.removeWrapperProperties(props);

    Object.assign(finalPoolConfig, Object.fromEntries(finalClientProps.entries()));
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

  setConnectTimeout(props: Map<string, any>, wrapperConnectTimeout?: any) {
    const timeout = wrapperConnectTimeout ?? props.get(WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name);
    if (timeout) {
      props.set(MySQL2DriverDialect.CONNECT_TIMEOUT_PROPERTY_NAME, timeout);
    }
  }

  setQueryTimeout(props: Map<string, any>, sql?: any, wrapperConnectTimeout?: any) {
    const timeout = wrapperConnectTimeout ?? props.get(WrapperProperties.WRAPPER_QUERY_TIMEOUT.name);
    if (timeout && !sql[MySQL2DriverDialect.QUERY_TIMEOUT_PROPERTY_NAME]) {
      sql[MySQL2DriverDialect.QUERY_TIMEOUT_PROPERTY_NAME] = timeout;
    }
  }

  setKeepAliveProperties(props: Map<string, any>, keepAliveProps: any) {
    if (keepAliveProps && keepAliveProps.get(MySQL2DriverDialect.KEEP_ALIVE_PROPERTY_NAME)) {
      throw new UnsupportedMethodError("Keep alive configuration is not supported for MySQL2.");
    }
  }
}
