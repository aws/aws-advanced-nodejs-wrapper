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

import { AwsClient } from "../../common/lib/aws_client";
import { HostInfo } from "../../common/lib/host_info";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { HostRole } from "../../common/lib/host_role";
import { PluginService } from "../../common/lib/plugin_service";
import { AwsMySQLClient } from "../../mysql/lib";
import { anything, instance, mock, reset, spy, when } from "ts-mockito";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { MySQLDatabaseDialect } from "../../mysql/lib/dialect/mysql_database_dialect";
import { HostListProvider } from "../../common/lib/host_list_provider/host_list_provider";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { InternalPooledConnectionProvider } from "../../common/lib/internal_pooled_connection_provider";
import { AwsPoolConfig } from "../../common/lib/aws_pool_config";
import { ConnectionProviderManager } from "../../common/lib/connection_provider_manager";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { AwsMysqlPoolClient } from "../../mysql/lib/mysql_pool_client";
import { PoolKey } from "../../common/lib/utils/pool_key";
import { InternalPoolMapping } from "../../common/lib/utils/internal_pool_mapping";
import { SlidingExpirationCache } from "../../common/lib/utils/sliding_expiration_cache";

const internalPoolWithOneConnection = mock(AwsMysqlPoolClient);
const user1 = "user1";
const user2 = "user2";
const db = "mydb";
const props: Map<string, any> = new Map();
const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const writerHost = builder.withHost("writer-host").withRole(HostRole.WRITER).build();
const readerHost1 = builder.withHost("instance1").withRole(HostRole.READER).build();
const readerHost2 = builder.withHost("instance2").withRole(HostRole.READER).build();
const readerUrl1Connection = "readerWith1connection.XYZ.us-east-1.rds.amazonaws.com";
const readerUrl2Connection = "readerWith2connection.XYZ.us-east-1.rds.amazonaws.com";
const writerUrlNoConnections = "writerWithNoConnections.XYZ.us-east-1.rds.amazonaws.com";
const readerHost1Connection = builder.withHost(readerUrl1Connection).withPort(5432).withRole(HostRole.READER).build();
const readerHost2Connection = builder.withHost(readerUrl2Connection).withPort(5432).withRole(HostRole.READER).build();
const writerHostNoConnection = builder.withHost(writerUrlNoConnections).withPort(5432).withRole(HostRole.WRITER).build();
const testHostsList = [writerHostNoConnection, readerHost1Connection, readerHost2Connection];
const target: SlidingExpirationCache<PoolKey, any> = new SlidingExpirationCache(BigInt(10000));
const result1 = target.computeIfAbsent(new PoolKey(readerHost2Connection.url, user1), () => internalPoolWithOneConnection, BigInt(10000));
const result2 = target.computeIfAbsent(new PoolKey(readerHost2Connection.url, user2), () => internalPoolWithOneConnection, BigInt(10000));
const result3 = target.computeIfAbsent(new PoolKey(readerHost1Connection.url, user1), () => internalPoolWithOneConnection, BigInt(10000));

const defaultHosts = [writerHost, readerHost1, readerHost2];
const mockPluginService: PluginService = mock(PluginService);
const mockReaderClient: AwsClient = mock(AwsMySQLClient);
const mockWriterClient: AwsClient = mock(AwsMySQLClient);
const mockMySQLClient: AwsClient = mock(AwsMySQLClient);
const mockHostInfo: HostInfo = mock(HostInfo);
const mockHostListProviderService: HostListProviderService = mock<HostListProviderService>();
const mockHostListProvider: HostListProvider = mock<HostListProvider>();
const mockClosedReaderClient: AwsClient = mock(AwsMySQLClient);
const mockClosedWriterClient: AwsClient = mock(AwsMySQLClient);
const mockDialect: MySQLDatabaseDialect = mock(MySQLDatabaseDialect);
const mockPoolConnection = mock(AwsMysqlPoolClient);
const mockAwsPoolClient = mock(AwsMysqlPoolClient);
const mockRdsUtils = mock(RdsUtils);
const mockPoolConfig = mock(AwsPoolConfig);
const mockDialectInstance = instance(mockDialect);

describe("reader write splitting test", () => {
  beforeEach(() => {
    when(mockPluginService.getHostListProvider()).thenReturn(instance(mockHostListProvider));
    when(mockPluginService.getHosts()).thenReturn(defaultHosts);
    when(mockPluginService.isInTransaction()).thenReturn(false);
    props.clear();
  });

  afterEach(() => {
    reset(mockReaderClient);
    reset(mockMySQLClient);
    reset(mockHostInfo);
    reset(mockPluginService);
    reset(mockHostListProviderService);
    reset(mockReaderClient);
    reset(mockWriterClient);
    reset(mockClosedReaderClient);
    reset(mockClosedWriterClient);
  });
  const mockRdsUtilsInstance = instance(mockRdsUtils);

  it("test connect with default mapping", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("instance1").build();
    when(mockPluginService.getCurrentHostInfo()).thenReturn(hostInfo);
    when(mockRdsUtils.isRdsInstance("instance1")).thenReturn(true);

    props.set(WrapperProperties.USER.name, "mySqlUser");
    props.set(WrapperProperties.PASSWORD.name, "mySqlPassword");

    when(mockRdsUtils.isRdsDns(anything())).thenReturn(null);
    when(mockRdsUtils.isGreenInstance(anything())).thenReturn(null);
    when(mockRdsUtils.isRdsInstance("instance1")).thenReturn(true);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockDialect.getAwsPoolClient(anything())).thenReturn(mockAwsPoolClient);
    const config = {
      maxConnection: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    };
    when(mockDialect.preparePoolClientProperties(anything(), anything())).thenReturn(config);
    const poolConfig: AwsPoolConfig = new AwsPoolConfig(config);

    const provider = spy(new InternalPooledConnectionProvider(poolConfig));
    const providerSpy = instance(provider);
    when(await provider.getPoolConnection()).thenReturn(mockPoolConnection);

    await providerSpy.connect(hostInfo, mockPluginServiceInstance, props);
    const expectedKeys: Set<PoolKey> = new Set<PoolKey>();
    expectedKeys.add(new PoolKey("instance1/", "mySqlUser"));

    const expectedHosts = new Set<string>();
    expectedHosts.add("instance1/");
    expect(providerSpy.getHostCount()).toBe(1);
    expect(providerSpy.getKeySet()).toEqual(expectedKeys);
    expect(providerSpy.getHostUrlSet()).toEqual(expectedHosts);
    await provider.releaseResources();
    ConnectionProviderManager.resetProvider();
  });

  it("test connect with custom mapping", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("instance1").build();
    when(mockPluginService.getCurrentHostInfo()).thenReturn(hostInfo);
    when(mockRdsUtils.isRdsInstance("instance1")).thenReturn(true);

    props.set(WrapperProperties.USER.name, "mysqlUser");
    props.set(WrapperProperties.PASSWORD.name, "mysqlPassword");

    when(mockRdsUtils.isRdsDns(anything())).thenReturn(null);
    when(mockRdsUtils.isGreenInstance(anything())).thenReturn(null);
    when(mockRdsUtils.isRdsInstance("instance1")).thenReturn(true);
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockDialect.getAwsPoolClient(anything())).thenReturn(mockAwsPoolClient);
    const config = {
      maxConnection: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    };
    const myKeyFunc: InternalPoolMapping = {
      getKey: (hostInfo: HostInfo, props: Map<string, any>) => {
        return hostInfo.url + "someKey";
      }
    };
    when(mockDialect.preparePoolClientProperties(anything(), anything())).thenReturn(config);
    const poolConfig: AwsPoolConfig = new AwsPoolConfig(config);

    const provider = spy(new InternalPooledConnectionProvider(poolConfig, myKeyFunc));
    const providerSpy = instance(provider);
    when(await provider.getPoolConnection()).thenReturn(mockPoolConnection);

    await providerSpy.connect(hostInfo, mockPluginServiceInstance, props);
    const expectedKeys: Set<PoolKey> = new Set<PoolKey>();
    expectedKeys.add(new PoolKey("instance1/", "instance1/someKey"));

    const expectedHosts = new Set<string>();
    expectedHosts.add("instance1/");
    expect(providerSpy.getHostCount()).toBe(1);
    expect(providerSpy.getKeySet()).toEqual(expectedKeys);
    expect(providerSpy.getHostUrlSet()).toEqual(expectedHosts);
    await provider.releaseResources();
    ConnectionProviderManager.resetProvider();
  });

  it("test random strategy", async () => {
    const provider = spy(new InternalPooledConnectionProvider(mockPoolConfig));
    const providerSpy = instance(provider);
    providerSpy.setDatabasePools(target);
    const selectedHost = providerSpy.getHostInfoByStrategy(testHostsList, HostRole.READER, "random", props);
    expect(selectedHost.host === readerUrl1Connection || selectedHost.host === readerUrl2Connection).toBeTruthy();
    await provider.releaseResources();
    ConnectionProviderManager.resetProvider();
  });

  it("test connect to deleted instance", async () => {
    const mockPluginServiceInstance = instance(mockPluginService);
    const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("instance1").build();
    const poolConfig: AwsPoolConfig = new AwsPoolConfig(props);

    when(mockPluginService.getCurrentHostInfo()).thenReturn(hostInfo);
    when(mockPluginService.getDialect()).thenReturn(mockDialectInstance);
    when(mockRdsUtils.isRdsDns(anything())).thenReturn(null);
    when(mockRdsUtils.isGreenInstance(anything())).thenReturn(null);
    when(mockRdsUtils.isRdsInstance("instance1")).thenReturn(true);
    when(mockDialect.preparePoolClientProperties(anything(), anything())).thenReturn(props);
    when(mockDialect.getAwsPoolClient(anything())).thenThrow(new Error("testError"));

    const provider = spy(new InternalPooledConnectionProvider(poolConfig));
    const providerSpy = instance(provider);
    when(await provider.getPoolConnection()).thenReturn(mockPoolConnection);

    try {
      await providerSpy.connect(hostInfo, mockPluginServiceInstance, props);
      throw new Error("did not catch error");
    } catch (error: any) {
      expect(error.message).toEqual("testError");
    }
    await provider.releaseResources();
    ConnectionProviderManager.resetProvider();
  });
});
