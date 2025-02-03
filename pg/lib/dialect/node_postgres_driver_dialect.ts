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

import pkgPg from "pg";

import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { AwsPoolConfig } from "../../../common/lib/aws_pool_config";
import { AwsPoolClient } from "../../../common/lib/aws_pool_client";
import { AwsPgPoolClient } from "../pg_pool_client";
import { PgClientWrapper } from "../../../common/lib/pg_client_wrapper";
import { HostInfo } from "../../../common/lib/host_info";

export class NodePostgresDriverDialect implements DriverDialect {
  protected dialectName: string = this.constructor.name;
  private static readonly CONNECT_TIMEOUT_PROPERTY_NAME = "connectionTimeoutMillis";
  private static readonly QUERY_TIMEOUT_PROPERTY_NAME = "query_timeout";
  private static readonly KEEP_ALIVE_PROPERTY_NAME = "keepAlive";
  private static readonly KEEP_ALIVE_INITIAL_DELAY_MILLIS_PROPERTY_NAME = "keepAliveInitialDelayMillis";

  getDialectName(): string {
    return this.dialectName;
  }

  async connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper> {
    const driverProperties = WrapperProperties.removeWrapperProperties(props);
    this.setKeepAliveProperties(driverProperties, props.get(WrapperProperties.KEEPALIVE_PROPERTIES.name));
    this.setConnectTimeout(driverProperties, props.get(WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name));
    this.setQueryTimeout(driverProperties, props.get(WrapperProperties.WRAPPER_QUERY_TIMEOUT.name));
    const targetClient = new pkgPg.Client(Object.fromEntries(driverProperties.entries()));
    await targetClient.connect();
    return Promise.resolve(new PgClientWrapper(targetClient, hostInfo, props));
  }

  preparePoolClientProperties(props: Map<string, any>, poolConfig: AwsPoolConfig | undefined): any {
    const finalPoolConfig: pkgPg.PoolConfig = {};
    const finalClientProps = WrapperProperties.removeWrapperProperties(props);

    Object.assign(finalPoolConfig, Object.fromEntries(finalClientProps.entries()));
    finalPoolConfig.max = poolConfig?.maxConnections;
    finalPoolConfig.idleTimeoutMillis = poolConfig?.idleTimeoutMillis;
    finalPoolConfig.allowExitOnIdle = poolConfig?.allowExitOnIdle;
    finalPoolConfig.min = poolConfig?.minConnections;

    return finalPoolConfig;
  }

  getAwsPoolClient(props: pkgPg.PoolConfig): AwsPoolClient {
    return new AwsPgPoolClient(props);
  }

  setConnectTimeout(props: Map<string, any>, wrapperConnectTimeout?: any) {
    const timeout = wrapperConnectTimeout ?? props.get(WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name);
    if (timeout) {
      props.set(NodePostgresDriverDialect.CONNECT_TIMEOUT_PROPERTY_NAME, timeout);
    }
  }

  setQueryTimeout(props: Map<string, any>, sql?: any, wrapperQueryTimeout?: any) {
    const timeout = wrapperQueryTimeout ?? props.get(WrapperProperties.WRAPPER_QUERY_TIMEOUT.name);
    if (timeout) {
      props.set(NodePostgresDriverDialect.QUERY_TIMEOUT_PROPERTY_NAME, timeout);
    }
  }

  setKeepAliveProperties(props: Map<string, any>, keepAliveProps: any) {
    if (!keepAliveProps) {
      return;
    }

    const keepAlive = keepAliveProps[NodePostgresDriverDialect.KEEP_ALIVE_PROPERTY_NAME];
    const keepAliveInitialDelayMillis = keepAliveProps[NodePostgresDriverDialect.KEEP_ALIVE_INITIAL_DELAY_MILLIS_PROPERTY_NAME];

    if (keepAlive !== undefined) {
      props.set(NodePostgresDriverDialect.KEEP_ALIVE_PROPERTY_NAME, keepAlive);
    }
    if (keepAliveInitialDelayMillis !== undefined) {
      props.set(NodePostgresDriverDialect.KEEP_ALIVE_INITIAL_DELAY_MILLIS_PROPERTY_NAME, keepAliveInitialDelayMillis);
    }
  }
}
