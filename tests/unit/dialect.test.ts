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

import { MySQLDatabaseDialect } from "../../mysql/lib/dialect/mysql_database_dialect";
import { PgDatabaseDialect } from "../../pg/lib/dialect/pg_database_dialect";
import { AuroraPgDatabaseDialect } from "../../pg/lib/dialect/aurora_pg_database_dialect";
import { AuroraMySQLDatabaseDialect } from "../../mysql/lib/dialect/aurora_mysql_database_dialect";
import { RdsMySQLDatabaseDialect } from "../../mysql/lib/dialect/rds_mysql_database_dialect";
import { RdsPgDatabaseDialect } from "../../pg/lib/dialect/rds_pg_database_dialect";
import { DatabaseDialect, DatabaseType } from "../../common/lib/database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../../common/lib/database_dialect/database_dialect_codes";
import { DatabaseDialectManager } from "../../common/lib/database_dialect/database_dialect_manager";
import { PluginService } from "../../common/lib/plugin_service";
import { PluginServiceManagerContainer } from "../../common/lib/plugin_service_manager_container";
import { AwsPGClient } from "../../pg/lib";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { ClientWrapper } from "../../common/lib/client_wrapper"

const mysqlDialect = new MySQLDatabaseDialect();
const rdsMysqlDialect = new RdsMySQLDatabaseDialect();
const auroraMysqlDialect = new AuroraMySQLDatabaseDialect();
const pgDialect = new PgDatabaseDialect();
const rdsPgDialect = new RdsPgDatabaseDialect();
const auroraPgDialect = new AuroraPgDatabaseDialect();

const LOCALHOST = "localhost";
const RDS_DATABASE = "database-1.xyz.us-east-2.rds.amazonaws.com";
const RDS_AURORA_DATABASE = "database-2.cluster-xyz.us-east-2.rds.amazonaws.com";

const mysqlDialects = new Map([
  [DatabaseDialectCodes.MYSQL, mysqlDialect],
  [DatabaseDialectCodes.RDS_MYSQL, rdsMysqlDialect],
  [DatabaseDialectCodes.AURORA_MYSQL, auroraMysqlDialect]
]);

const pgDialects = new Map([
  [DatabaseDialectCodes.PG, pgDialect],
  [DatabaseDialectCodes.RDS_PG, rdsPgDialect],
  [DatabaseDialectCodes.AURORA_PG, auroraPgDialect]
]);

const mysqlVersionCommentResult = [
  [
    {
      Variable_name: "version_comment",
      Value: "MySQL Community Server (GPL)"
    }
  ]
];
const rdsMysqlVersionCommentResult = [
  [
    {
      Variable_name: "version_comment",
      Value: "Source distribution"
    }
  ]
];
const mysqlAuroraQueryResult = [
  [
    {
      Variable_name: "aurora_version",
      Value: "2.11.2"
    }
  ]
];
const pgProcResult = {
  rows: [{ "?column?": 1 }]
};
const pgExtensionsResult = {
  rows: [{ rds_tools: true, aurora_stat_utils: false }]
};
const pgAuroraStatUtilsResult = {
  rows: [{ aurora_stat_utils: true }]
};

const pluginServiceManagerContainer = new PluginServiceManagerContainer();
const mockClient = new AwsPGClient({});

class MockTargetClient {
  readonly expectedResults;
  counter = 0;

  constructor(expectedResults: any[]) {
    this.expectedResults = expectedResults;
  }

  query(sql: any) {
    const response = this.expectedResults[this.counter];
    if (this.counter < this.expectedResults.length - 1) {
      this.counter++;
    }
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve(response);
  }

  promise() {
    return this;
  }
}

describe("test dialects", () => {
  it.each([
    [mysqlDialects, LOCALHOST, mysqlDialect, DatabaseType.MYSQL],
    [mysqlDialects, RDS_DATABASE, rdsMysqlDialect, DatabaseType.MYSQL],
    [mysqlDialects, RDS_AURORA_DATABASE, auroraMysqlDialect, DatabaseType.MYSQL],
    [pgDialects, LOCALHOST, pgDialect, DatabaseType.POSTGRES],
    [pgDialects, RDS_DATABASE, rdsPgDialect, DatabaseType.POSTGRES],
    [pgDialects, RDS_AURORA_DATABASE, auroraPgDialect, DatabaseType.POSTGRES]
  ])(
    "get initial dialect",
    async (knownDialects: Map<string, DatabaseDialect>, host: string, expectedDialect: DatabaseDialect, dbType: DatabaseType) => {
      const props = new Map();
      props.set(WrapperProperties.HOST.name, host);
      const dialectManager = new DatabaseDialectManager(knownDialects, dbType, props);
      expect(dialectManager.getDialect(props)).toBe(expectedDialect);
    }
  );

  // Cases:
  // MySQLDatabaseDialect unchanged
  // RdsMySQLDatabaseDialect unchanged
  // AuroraMySQLDatabaseDialect unchanged
  // MySQLDatabaseDialect to RdsMySQLDatabaseDialect
  // MySQLDatabaseDialect to AuroraMySQLDatabaseDialect
  // RdsMySQLDatabaseDialect to AuroraMySQLDatabaseDialect
  // PgDatabaseDialect unchanged
  // RdsPgDatabaseDialect unchanged
  // AuroraPgDatabaseDialect unchanged
  // PgDatabaseDialect to RdsPgDatabaseDialect
  // PgDatabaseDialect to AuroraPgDatabaseDialect
  // RdsPgDatabaseDialect to AuroraPgDatabaseDialect
  it.each([
    [mysqlDialects, LOCALHOST, DatabaseType.MYSQL, mysqlDialect, [new Error()]],
    [mysqlDialects, RDS_DATABASE, DatabaseType.MYSQL, rdsMysqlDialect, [new Error(), rdsMysqlVersionCommentResult]],
    [mysqlDialects, RDS_AURORA_DATABASE, DatabaseType.MYSQL, auroraMysqlDialect, [mysqlAuroraQueryResult]],
    [mysqlDialects, LOCALHOST, DatabaseType.MYSQL, rdsMysqlDialect, [new Error(), rdsMysqlVersionCommentResult]],
    [mysqlDialects, LOCALHOST, DatabaseType.MYSQL, auroraMysqlDialect, [mysqlAuroraQueryResult]],
    [mysqlDialects, RDS_DATABASE, DatabaseType.MYSQL, auroraMysqlDialect, [mysqlAuroraQueryResult]],
    [pgDialects, LOCALHOST, DatabaseType.POSTGRES, pgDialect, [new Error()]],
    [pgDialects, RDS_DATABASE, DatabaseType.POSTGRES, rdsPgDialect, [new Error(), pgExtensionsResult]],
    [pgDialects, RDS_AURORA_DATABASE, DatabaseType.POSTGRES, auroraPgDialect, [pgProcResult, pgAuroraStatUtilsResult]],
    [pgDialects, LOCALHOST, DatabaseType.POSTGRES, rdsPgDialect, [new Error(), pgProcResult, pgExtensionsResult]],
    [pgDialects, LOCALHOST, DatabaseType.POSTGRES, auroraPgDialect, [pgProcResult, pgAuroraStatUtilsResult]],
    [pgDialects, RDS_DATABASE, DatabaseType.POSTGRES, auroraPgDialect, [pgProcResult, pgAuroraStatUtilsResult]]
  ])(
    "update dialect",
    async (
      knownDialects: Map<string, DatabaseDialect>,
      host: string,
      dbType: DatabaseType,
      expectedDialect: DatabaseDialect,
      expectedResults: any[]
    ) => {
      const props = new Map();
      props.set(WrapperProperties.HOST.name, host);

      const mockTargetClient = new MockTargetClient(expectedResults);
      const currentHostInfo = new HostInfoBuilder({
        host: "foo",
        port: 1234,
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
      }).build();

      const mockClientWrapper : ClientWrapper = { 
        client : mockTargetClient,
        hostInfo : currentHostInfo,
        properties : new Map<string, any>()}

      const pluginService = new PluginService(pluginServiceManagerContainer, mockClient, dbType, knownDialects, props);
      await pluginService.updateDialect(mockClientWrapper);
      expect(pluginService.getDialect()).toBe(expectedDialect);
    }
  );
});
