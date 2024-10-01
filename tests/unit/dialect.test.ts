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
import { PluginService } from "../../common/lib/plugin_service";
import { PluginServiceManagerContainer } from "../../common/lib/plugin_service_manager_container";
import { AwsPGClient } from "../../pg/lib";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { RdsMultiAZMySQLDatabaseDialect } from "../../mysql/lib/dialect/rds_multi_az_mysql_database_dialect";
import { RdsMultiAZPgDatabaseDialect } from "../../pg/lib/dialect/rds_multi_az_pg_database_dialect";
import { DatabaseDialectManager } from "../../common/lib/database_dialect/database_dialect_manager";

const LOCALHOST = "localhost";
const RDS_DATABASE = "database-1.xyz.us-east-2.rds.amazonaws.com";
const RDS_AURORA_DATABASE = "database-2.cluster-xyz.us-east-2.rds.amazonaws.com";

const mysqlDialects: Map<DatabaseDialectCodes, DatabaseDialect> = new Map([
  [DatabaseDialectCodes.MYSQL, new MySQLDatabaseDialect()],
  [DatabaseDialectCodes.RDS_MYSQL, new RdsMySQLDatabaseDialect()],
  [DatabaseDialectCodes.AURORA_MYSQL, new AuroraMySQLDatabaseDialect()],
  [DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL, new RdsMultiAZMySQLDatabaseDialect()]
]);

const pgDialects: Map<DatabaseDialectCodes, DatabaseDialect> = new Map([
  [DatabaseDialectCodes.PG, new PgDatabaseDialect()],
  [DatabaseDialectCodes.RDS_PG, new RdsPgDatabaseDialect()],
  [DatabaseDialectCodes.AURORA_PG, new AuroraPgDatabaseDialect()],
  [DatabaseDialectCodes.RDS_MULTI_AZ_PG, new RdsMultiAZPgDatabaseDialect()]
]);

const MYSQL_QUERY = "SHOW VARIABLES LIKE 'version_comment'";
const RDS_MYSQL_QUERY = "SHOW VARIABLES LIKE 'version_comment'";
const AURORA_MYSQL_QUERY = "SHOW VARIABLES LIKE 'aurora_version'";
const TAZ_MYSQL_QUERIES: string[] = [
  "SELECT 1 AS tmp FROM information_schema.tables WHERE" + " table_schema = 'mysql' AND table_name = 'rds_topology'",
  "SELECT id, endpoint, port FROM mysql.rds_topology"
];
const PG_QUERY = "SELECT 1 FROM pg_proc LIMIT 1";
const RDS_PG_QUERY =
  "SELECT (setting LIKE '%rds_tools%') AS rds_tools, (setting LIKE '%aurora_stat_utils%') AS aurora_stat_utils " +
  "FROM pg_settings WHERE name='rds.extensions'";
const AURORA_PG_QUERY = "SELECT (setting LIKE '%aurora_stat_utils%') AS aurora_stat_utils FROM pg_settings WHERE name='rds.extensions'";
const TAZ_PG_QUERIES: string[] = [
  "SELECT 1 AS tmp FROM information_schema.routines WHERE routine_schema='rds_tools' AND routine_name='multi_az_db_cluster_source_dbi_resource_id'",
  "SELECT multi_az_db_cluster_source_dbi_resource_id FROM rds_tools.multi_az_db_cluster_source_dbi_resource_id()"
];

const mysqlResult = [
  [
    {
      Variable_name: "version_comment",
      Value: "MySQL Community Server (GPL)"
    }
  ]
];
const rdsMysqlResult = [
  [
    {
      Variable_name: "version_comment",
      Value: "Source distribution"
    }
  ]
];
const mysqlAuroraResult = [
  [
    {
      Variable_name: "aurora_version",
      Value: "2.11.2"
    }
  ]
];
const tazMySQLResult = [
  [
    {
      Variable_name: "id",
      Value: "315637017"
    },
    {
      Variable_name: "endpoint",
      Value: "db-instance.hash.region.rds.amazonaws.com"
    },
    {
      Variable_name: "port",
      Value: "3306s"
    }
  ]
];

const pgResult = {
  rows: [{ "?column?": 1 }]
};
const pgRdsResult = {
  rows: [{ rds_tools: true, aurora_stat_utils: false }]
};
const pgAuroraResult = {
  rows: [{ aurora_stat_utils: true }]
};
const tazPgResult = {
  rows: [{ multi_az_db_cluster_source_dbi_resource_id: "db-GRC4XL62OGZSWSV4OWABAJM5HNI" }]
};

type DialectInputOutput = {
  dialects: Map<DatabaseDialectCodes, DatabaseDialect>;
  inputs: string[];
  output: any;
};

const expectedDialectMapping: Map<DatabaseDialectCodes, DialectInputOutput> = new Map([
  [DatabaseDialectCodes.MYSQL, { dialects: mysqlDialects, inputs: [MYSQL_QUERY], output: mysqlResult }],
  [
    DatabaseDialectCodes.RDS_MYSQL,
    {
      dialects: mysqlDialects,
      inputs: [RDS_MYSQL_QUERY],
      output: rdsMysqlResult
    }
  ],
  [
    DatabaseDialectCodes.AURORA_MYSQL,
    {
      dialects: mysqlDialects,
      inputs: [AURORA_MYSQL_QUERY],
      output: mysqlAuroraResult
    }
  ],
  [
    DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL,
    {
      dialects: mysqlDialects,
      inputs: TAZ_MYSQL_QUERIES,
      output: tazMySQLResult
    }
  ],
  [DatabaseDialectCodes.PG, { dialects: pgDialects, inputs: [PG_QUERY], output: pgResult }],
  [DatabaseDialectCodes.RDS_PG, { dialects: pgDialects, inputs: [PG_QUERY, RDS_PG_QUERY], output: pgRdsResult }],
  [
    DatabaseDialectCodes.AURORA_PG,
    {
      dialects: pgDialects,
      inputs: [PG_QUERY, AURORA_PG_QUERY],
      output: pgAuroraResult
    }
  ],
  [
    DatabaseDialectCodes.RDS_MULTI_AZ_PG,
    {
      dialects: pgDialects,
      inputs: TAZ_PG_QUERIES,
      output: tazPgResult
    }
  ]
]);

const pluginServiceManagerContainer = new PluginServiceManagerContainer();
const mockClient = new AwsPGClient({});

class MockTargetClient {
  readonly expectedInputs: string[];
  readonly expectedResultSet: any[];

  constructor(expectedInputs: string[], expectedResultSet: any[]) {
    this.expectedInputs = expectedInputs;
    this.expectedResultSet = expectedResultSet;
  }

  query(sql: any) {
    if (this.expectedInputs.includes(sql)) {
      return Promise.resolve(this.expectedResultSet);
    }

    return Promise.reject(new Error("Unsupported query"));
  }

  promise() {
    return this;
  }
}

describe("test dialects", () => {
  it.each([
    [LOCALHOST, DatabaseDialectCodes.MYSQL, DatabaseType.MYSQL],
    [RDS_DATABASE, DatabaseDialectCodes.RDS_MYSQL, DatabaseType.MYSQL],
    [RDS_AURORA_DATABASE, DatabaseDialectCodes.AURORA_MYSQL, DatabaseType.MYSQL],
    [LOCALHOST, DatabaseDialectCodes.PG, DatabaseType.POSTGRES],
    [RDS_DATABASE, DatabaseDialectCodes.RDS_PG, DatabaseType.POSTGRES],
    [RDS_AURORA_DATABASE, DatabaseDialectCodes.AURORA_PG, DatabaseType.POSTGRES]
  ])("get initial dialect", async (host: string, expectedDialectCode: DatabaseDialectCodes, dbType: DatabaseType) => {
    const props = new Map();
    props.set(WrapperProperties.HOST.name, host);
    const expectedDialect: DialectInputOutput | undefined = expectedDialectMapping.get(expectedDialectCode);
    const expectedDialectClass: DatabaseDialect | undefined = expectedDialect!.dialects.get(expectedDialectCode);
    expect(expectedDialect).not.toBeUndefined();
    expect(expectedDialectClass).not.toBeUndefined();

    const dialectManager = new DatabaseDialectManager(expectedDialect!.dialects, dbType, props);
    expect(dialectManager.getDialect(props)).toBe(expectedDialectClass);
  });

  // Cases:
  // MySQLDatabaseDialect unchanged
  // RdsMySQLDatabaseDialect unchanged
  // AuroraMySQLDatabaseDialect unchanged
  // MySQLDatabaseDialect to RdsMySQLDatabaseDialect
  // MySQLDatabaseDialect to AuroraMySQLDatabaseDialect
  // RdsMySQLDatabaseDialect to AuroraMySQLDatabaseDialect
  // RdsMySQLDatabaseDialect to RdsMultiAZMySQLDatabaseDialect
  // AuroraMySQLDatabaseDialect to RdsMultiAZMySQLDatabaseDialect
  //
  // PgDatabaseDialect unchanged
  // RdsPgDatabaseDialect unchanged
  // AuroraPgDatabaseDialect unchanged
  // PgDatabaseDialect to RdsPgDatabaseDialect
  // PgDatabaseDialect to AuroraPgDatabaseDialect
  // RdsPgDatabaseDialect to AuroraPgDatabaseDialect
  // RdsPgDatabaseDialect to RdsMultiAZPgDatabaseDialect
  // AuroraPgDatabaseDialect to RdsMultiAZPgDatabaseDialect
  it.each([
    [DatabaseType.MYSQL, LOCALHOST, DatabaseDialectCodes.MYSQL],
    [DatabaseType.MYSQL, RDS_DATABASE, DatabaseDialectCodes.RDS_MYSQL],
    [DatabaseType.MYSQL, RDS_AURORA_DATABASE, DatabaseDialectCodes.AURORA_MYSQL],
    [DatabaseType.MYSQL, LOCALHOST, DatabaseDialectCodes.RDS_MYSQL],
    [DatabaseType.MYSQL, LOCALHOST, DatabaseDialectCodes.AURORA_MYSQL],
    [DatabaseType.MYSQL, RDS_DATABASE, DatabaseDialectCodes.AURORA_MYSQL],
    [DatabaseType.MYSQL, RDS_DATABASE, DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL],
    [DatabaseType.MYSQL, RDS_AURORA_DATABASE, DatabaseDialectCodes.RDS_MULTI_AZ_MYSQL],
    [DatabaseType.POSTGRES, LOCALHOST, DatabaseDialectCodes.PG],
    [DatabaseType.POSTGRES, RDS_DATABASE, DatabaseDialectCodes.RDS_PG],
    [DatabaseType.POSTGRES, RDS_AURORA_DATABASE, DatabaseDialectCodes.AURORA_PG],
    [DatabaseType.POSTGRES, LOCALHOST, DatabaseDialectCodes.RDS_PG],
    [DatabaseType.POSTGRES, LOCALHOST, DatabaseDialectCodes.AURORA_PG],
    [DatabaseType.POSTGRES, RDS_DATABASE, DatabaseDialectCodes.AURORA_PG],
    [DatabaseType.POSTGRES, RDS_DATABASE, DatabaseDialectCodes.RDS_MULTI_AZ_PG],
    [DatabaseType.POSTGRES, RDS_AURORA_DATABASE, DatabaseDialectCodes.RDS_MULTI_AZ_PG]
  ])("update dialect", async (databaseType: DatabaseType, host: string, expectedDialectCode: DatabaseDialectCodes) => {
    const props = new Map();
    props.set(WrapperProperties.HOST.name, host);
    const expectedDialect: DialectInputOutput | undefined = expectedDialectMapping.get(expectedDialectCode);
    expect(expectedDialect).not.toBeUndefined();
    const expectedDialectClass: DatabaseDialect | undefined = expectedDialect!.dialects.get(expectedDialectCode);
    expect(expectedDialectClass).not.toBeUndefined();

    const mockTargetClient = new MockTargetClient(expectedDialect!.inputs, expectedDialect!.output);
    const currentHostInfo = new HostInfoBuilder({
      host: "foo",
      port: 1234,
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    }).build();

    const mockClientWrapper: ClientWrapper = {
      client: mockTargetClient,
      hostInfo: currentHostInfo,
      properties: new Map<string, any>()
    };
    const pluginService = new PluginService(pluginServiceManagerContainer, mockClient, databaseType, expectedDialect!.dialects, props);
    await pluginService.updateDialect(mockClientWrapper);
    expect(pluginService.getDialect()).toBe(expectedDialectClass);
  });
});
