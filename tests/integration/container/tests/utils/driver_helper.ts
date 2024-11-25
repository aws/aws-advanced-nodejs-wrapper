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

import { TestDriver } from "./test_driver";
import { AwsMySQLClient } from "../../../../../mysql/lib";
import { AwsPGClient } from "../../../../../pg/lib";
import { DatabaseEngine } from "./database_engine";
import { AwsClient } from "../../../../../common/lib/aws_client";
import { DatabaseEngineDeployment } from "./database_engine_deployment";

export class DriverHelper {
  static getClient(driver: TestDriver) {
    switch (driver) {
      case TestDriver.MYSQL:
        return (options: any) => new AwsMySQLClient(options);
      case TestDriver.PG:
        return (options: any) => new AwsPGClient(options);
      default:
        throw new Error("invalid driver");
    }
  }

  static getDriverForDatabaseEngine(engine: DatabaseEngine): TestDriver {
    switch (engine) {
      case DatabaseEngine.PG:
        return TestDriver.PG;
      case DatabaseEngine.MYSQL:
        return TestDriver.MYSQL;
      default:
        throw new Error("invalid engine");
    }
  }

  static getInstanceIdSql(engine: DatabaseEngine, deployment: DatabaseEngineDeployment): string {
    switch (deployment) {
      case DatabaseEngineDeployment.AURORA:
        switch (engine) {
          case DatabaseEngine.PG:
            return "SELECT aurora_db_instance_identifier() as id";
          case DatabaseEngine.MYSQL:
            return "SELECT @@aurora_server_id as id";
          default:
            throw new Error("invalid engine");
        }
      case DatabaseEngineDeployment.RDS_MULTI_AZ_CLUSTER:
        switch (engine) {
          case DatabaseEngine.PG:
            return "SELECT SUBSTRING(endpoint FROM 0 FOR POSITION('.' IN endpoint)) as id FROM rds_tools.show_topology() WHERE id IN (SELECT dbi_resource_id FROM rds_tools.dbi_resource_id())";
          case DatabaseEngine.MYSQL:
            return "SELECT SUBSTRING_INDEX(endpoint, '.', 1) as id FROM mysql.rds_topology WHERE id=@@server_id";
          default:
            throw new Error("invalid engine");
        }
      default:
        throw new Error("invalid deployment");
    }
  }

  static async executeInstanceQuery(engine: DatabaseEngine, deployment: DatabaseEngineDeployment, client: AwsClient) {
    const sql = DriverHelper.getInstanceIdSql(engine, deployment);
    let result;
    switch (engine) {
      case DatabaseEngine.PG:
        return await (client as AwsPGClient).query(sql).then((result) => {
          return result.rows[0]["id"];
        });
      case DatabaseEngine.MYSQL:
        result = await (client as AwsMySQLClient).query({ sql: sql });
        return JSON.parse(JSON.stringify(result))[0][0]["id"];
      default:
        throw new Error("invalid engine");
    }
  }

  static getSleepQuery(engine: DatabaseEngine, seconds: number) {
    switch (engine) {
      case DatabaseEngine.PG:
        return `select pg_sleep(${seconds})`;
      case DatabaseEngine.MYSQL:
        return `select sleep(${seconds})`;
      default:
        throw new Error("invalid engine");
    }
  }

  static async executeQuery(engine: DatabaseEngine, client: AwsClient, sql: string, timeoutValue?: number) {
    switch (engine) {
      case DatabaseEngine.PG:
        return await (client as AwsPGClient).query(sql);
      case DatabaseEngine.MYSQL:
        return await (client as AwsMySQLClient).query({ sql: sql, timeout: timeoutValue });
      default:
        throw new Error("invalid engine");
    }
  }

  static addDriverSpecificConfiguration(props: any, engine: DatabaseEngine, performance: boolean = false) {
    if (engine === DatabaseEngine.PG && !performance) {
      props["query_timeout"] = 10000;
      props["ssl"] = { rejectUnauthorized: false };
    } else if (engine === DatabaseEngine.PG && performance) {
      props["query_timeout"] = 120000;
      props["connectionTimeoutMillis"] = 3000;
      props["monitoring_query_timeout"] = 3000;
    } else if (engine === DatabaseEngine.MYSQL && performance) {
      props["connectTimeout"] = 3000;
      props["monitoring_wrapperQueryTimeout"] = 3000;
      props["wrapperQueryTimeout"] = 120000;
    }
    return props;
  }
}
