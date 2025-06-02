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

import { anything, instance, mock, reset, spy, when } from "ts-mockito";
import { SessionStateServiceImpl } from "../../common/lib/session_state_service_impl";
import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { AwsPGClient } from "../../pg/lib";
import { SessionStateService } from "../../common/lib/session_state_service";
import { AwsClient } from "../../common/lib/aws_client";
import { AwsMySQLClient } from "../../mysql/lib";
import { PgClientWrapper } from "../../common/lib/pg_client_wrapper";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { MySQLDatabaseDialect } from "../../mysql/lib/dialect/mysql_database_dialect";
import { PgDatabaseDialect } from "../../pg/lib/dialect/pg_database_dialect";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";

const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const mockPluginService = mock(PluginServiceImpl);
let awsPGClient: AwsClient;
let mockAwsPGClient: AwsClient;
let awsMySQLClient: AwsClient;
let mockAwsMySQLClient: AwsClient;
let sessionStateService: SessionStateService;
const mockPgClientWrapper: PgClientWrapper = mock(PgClientWrapper);
const mockMySQLClientWrapper: MySQLClientWrapper = mock(MySQLClientWrapper);
const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build();
const mockMySQLDriverDialect = mock(MySQL2DriverDialect);

describe("testSessionStateServiceImpl", () => {
  beforeEach(() => {
    awsPGClient = new AwsPGClient({});
    mockAwsPGClient = spy(awsPGClient);
    awsMySQLClient = new AwsMySQLClient({});
    mockAwsMySQLClient = spy(awsMySQLClient);
    sessionStateService = new SessionStateServiceImpl(instance(mockPluginService), new Map());
    awsPGClient.targetClient = new PgClientWrapper(undefined, hostInfoBuilder.withHost("host").build(), new Map());
    mockAwsPGClient.targetClient = new PgClientWrapper(undefined, hostInfoBuilder.withHost("host").build(), new Map());
    awsMySQLClient.targetClient = new MySQLClientWrapper(undefined, hostInfoBuilder.withHost("host").build(), new Map(), mockMySQLDriverDialect);
    mockAwsMySQLClient.targetClient = new MySQLClientWrapper(undefined, hostInfoBuilder.withHost("host").build(), new Map(), mockMySQLDriverDialect);
    when(mockMySQLClientWrapper.query(anything())).thenResolve();
    when(mockPgClientWrapper.query(anything())).thenResolve();
    when(mockPluginService.getSessionStateService()).thenReturn(sessionStateService);
  });

  afterEach(() => {
    reset(mockAwsPGClient);
    reset(mockPluginService);
  });

  it.each([
    [false, false, false, 0],
    [true, false, true, 0],
    [false, true, true, 0],
    [true, true, false, 0],
    [false, false, false, 1],
    [true, false, true, 1],
    [false, true, true, 1],
    [true, true, false, 1]
  ])("test reset client readOnly", async (pristineValue: boolean, value: boolean, shouldReset: boolean, driver: number) => {
    const mockAwsClient = driver === 0 ? mockAwsPGClient : mockAwsMySQLClient;
    const awsClient = driver === 0 ? awsPGClient : awsMySQLClient;
    if (driver === 0) {
      awsClient.targetClient = new PgClientWrapper(undefined, hostInfo, new Map());
      when(mockPluginService.getDialect()).thenReturn(new PgDatabaseDialect());
    } else {
      awsClient.targetClient = new MySQLClientWrapper(undefined, hostInfo, new Map(), mockMySQLDriverDialect);
      when(mockPluginService.getDialect()).thenReturn(new MySQLDatabaseDialect());
    }
    when(mockPluginService.getCurrentClient()).thenReturn(awsClient);
    when(mockAwsClient.isReadOnly()).thenReturn(pristineValue);
    expect(sessionStateService.getReadOnly()).toBe(undefined);
    sessionStateService.setupPristineReadOnly();
    sessionStateService.setReadOnly(value);
    expect(sessionStateService.getReadOnly()).toBe(value);

    sessionStateService.begin();
    await sessionStateService.applyPristineSessionState(awsClient);
    sessionStateService.complete();
    if (shouldReset) {
      // Should reset to pristine value
      expect(sessionStateService.getReadOnly()).toBe(pristineValue);
    } else {
      // No-op, value should stay unchanged
      expect(sessionStateService.getReadOnly()).toBe(value);
    }
  });

  it.each([
    [false, false, false, 1],
    [true, false, true, 1],
    [false, true, true, 1],
    [true, true, false, 1]
  ])("test reset client autoCommit", async (pristineValue: boolean, value: boolean, shouldReset: boolean, driver: number) => {
    const mockAwsClient = driver === 0 ? mockAwsPGClient : mockAwsMySQLClient;
    const awsClient = driver === 0 ? awsPGClient : awsMySQLClient;

    when(mockPluginService.getDialect()).thenReturn(new MySQLDatabaseDialect());
    when(mockPluginService.getCurrentClient()).thenReturn(awsClient);
    when(mockAwsClient.getAutoCommit()).thenReturn(pristineValue);
    expect(sessionStateService.getAutoCommit()).toBe(undefined);
    sessionStateService.setupPristineAutoCommit();
    sessionStateService.setAutoCommit(value);
    expect(sessionStateService.getAutoCommit()).toBe(value);

    sessionStateService.begin();
    await sessionStateService.applyPristineSessionState(awsClient);
    sessionStateService.complete();

    if (shouldReset) {
      // Should reset to pristine value
      expect(sessionStateService.getAutoCommit()).toBe(pristineValue);
    } else {
      // No-op, value should stay unchanged
      expect(sessionStateService.getAutoCommit()).toBe(value);
    }
  });

  it.each([
    ["a", "a", false, 1],
    ["b", "a", true, 1],
    ["a", "b", true, 1],
    ["b", "b", false, 1]
  ])("test reset client catalog", async (pristineValue: string, value: string, shouldReset: boolean, driver: number) => {
    const mockAwsClient = driver === 0 ? mockAwsPGClient : mockAwsMySQLClient;
    const awsClient = driver === 0 ? awsPGClient : awsMySQLClient;

    when(mockPluginService.getDialect()).thenReturn(new MySQLDatabaseDialect());
    when(mockPluginService.getCurrentClient()).thenReturn(awsClient);
    when(mockAwsClient.getCatalog()).thenReturn(pristineValue);
    expect(sessionStateService.getCatalog()).toBe(undefined);
    sessionStateService.setupPristineCatalog();
    sessionStateService.setCatalog(value);
    expect(sessionStateService.getCatalog()).toBe(value);

    sessionStateService.begin();
    await sessionStateService.applyPristineSessionState(awsClient);
    sessionStateService.complete();

    if (shouldReset) {
      // Should reset to pristine value
      expect(sessionStateService.getCatalog()).toBe(pristineValue);
    } else {
      // No-op, value should stay unchanged
      expect(sessionStateService.getCatalog()).toBe(value);
    }
  });

  it.each([
    ["a", "a", false, 0],
    ["b", "a", true, 0],
    ["a", "b", true, 0],
    ["b", "b", false, 0]
  ])("test reset client schema", async (pristineValue: string, value: string, shouldReset: boolean, driver: number) => {
    const mockAwsClient = driver === 0 ? mockAwsPGClient : mockAwsMySQLClient;
    const awsClient = driver === 0 ? awsPGClient : awsMySQLClient;

    when(mockPluginService.getDialect()).thenReturn(new PgDatabaseDialect());
    when(mockPluginService.getCurrentClient()).thenReturn(awsClient);
    when(mockAwsClient.getSchema()).thenReturn(pristineValue);
    expect(sessionStateService.getSchema()).toBe(undefined);
    sessionStateService.setupPristineSchema();
    sessionStateService.setSchema(value);
    expect(sessionStateService.getSchema()).toBe(value);

    sessionStateService.begin();
    await sessionStateService.applyPristineSessionState(awsClient);
    sessionStateService.complete();

    if (shouldReset) {
      // Should reset to pristine value
      expect(sessionStateService.getSchema()).toBe(pristineValue);
    } else {
      // No-op, value should stay unchanged
      expect(sessionStateService.getSchema()).toBe(value);
    }
  });

  it.each([
    [1, 1, false, 0],
    [2, 1, true, 0],
    [1, 2, true, 0],
    [2, 2, false, 0],
    [1, 1, false, 1],
    [2, 1, true, 1],
    [1, 2, true, 1],
    [2, 2, false, 1]
  ])("test reset client transaction isolation", async (pristineValue: number, value: number, shouldReset: boolean, driver: number) => {
    const mockAwsClient = driver === 0 ? mockAwsPGClient : mockAwsMySQLClient;
    const awsClient = driver === 0 ? awsPGClient : awsMySQLClient;

    if (driver === 0) {
      when(mockPluginService.getDialect()).thenReturn(new PgDatabaseDialect());
    } else {
      when(mockPluginService.getDialect()).thenReturn(new MySQLDatabaseDialect());
    }

    when(mockPluginService.getCurrentClient()).thenReturn(awsClient);
    when(mockAwsClient.getTransactionIsolation()).thenReturn(pristineValue);
    expect(sessionStateService.getTransactionIsolation()).toBe(undefined);
    sessionStateService.setupPristineTransactionIsolation();
    sessionStateService.setTransactionIsolation(value);
    expect(sessionStateService.getTransactionIsolation()).toBe(value);

    sessionStateService.begin();
    await sessionStateService.applyPristineSessionState(awsClient);
    sessionStateService.complete();

    if (shouldReset) {
      // Should reset to pristine value
      expect(sessionStateService.getTransactionIsolation()).toBe(pristineValue);
    } else {
      // No-op, value should stay unchanged
      expect(sessionStateService.getTransactionIsolation()).toBe(value);
    }
  });
});
