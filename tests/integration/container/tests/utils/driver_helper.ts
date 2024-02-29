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

  static executeInstanceQuery(engine: DatabaseEngine, client: AwsPGClient | AwsMySQLClient) {
    const sql = DriverHelper.getInstanceIdSql(engine);
    switch (engine) {
      case DatabaseEngine.PG:
        return (client as AwsPGClient).query(sql);
      case DatabaseEngine.MYSQL:
        return (client as AwsMySQLClient).query({ sql: sql, timeout: 10000 });
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
      default:
        break;
    }

    return props;
  }
}
