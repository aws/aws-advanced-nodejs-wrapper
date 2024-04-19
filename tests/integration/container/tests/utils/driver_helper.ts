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
import { AwsMySQLClient } from "mysql-wrapper/lib/client";
import { AwsPGClient } from "pg-wrapper/lib/client";
import { DatabaseEngine } from "./database_engine";
import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";

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

  static getInstanceIdSql(engine: DatabaseEngine): string {
    switch (engine) {
      case DatabaseEngine.PG:
        return "SELECT aurora_db_instance_identifier()";
      case DatabaseEngine.MYSQL:
        return "SELECT @@aurora_server_id as id";
      default:
        throw new Error("invalid engine");
    }
  }

  static async executeInstanceQuery(engine: DatabaseEngine, client: AwsClient) {
    const sql = DriverHelper.getInstanceIdSql(engine);
    let result;
    switch (engine) {
      case DatabaseEngine.PG:
        return await (client as AwsPGClient).query(sql).then((result) => {
          return result.rows[0]["aurora_db_instance_identifier"];
        });
      case DatabaseEngine.MYSQL:
        result = await (client as AwsMySQLClient).query({ sql: sql, timeout: 10000 });
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

  static async executeQuery(engine: DatabaseEngine, client: AwsClient, sql: string) {
    switch (engine) {
      case DatabaseEngine.PG:
        return await (client as AwsPGClient).query(sql);
      case DatabaseEngine.MYSQL:
        return await (client as AwsMySQLClient).query({ sql: sql, timeout: 10000 });
      default:
        throw new Error("invalid engine");
    }
  }

  static addDriverSpecificConfiguration(props: any, engine: DatabaseEngine) {
    switch (engine) {
      case DatabaseEngine.PG:
        props["query_timeout"] = 10000;
        break;
      case DatabaseEngine.MYSQL:
        break;
      default:
        break;
    }

    return props;
  }
}
