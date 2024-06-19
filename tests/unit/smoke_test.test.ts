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

import { AwsPGClient } from "pg-wrapper/lib/client";
import { AwsMySQLClient } from "mysql-wrapper";
import { ProxyHelper } from "../integration/container/tests/utils/proxy_helper";
import { TestEnvironment } from "../../dist/integration/container/tests/utils/test_environment";
import { DriverHelper } from "../integration/container/tests/utils/driver_helper";
import { AwsWrapperError, ReadWriteSplittingError } from "aws-wrapper-common-lib/lib/utils/errors";
import { sleep } from "aws-wrapper-common-lib/lib/utils/utils";

const MYSQL_DB_USER = "admin";
const MYSQL_DB_HOST = "atlas-mysql.cluster-cx422ywmsto6.us-east-2.rds.amazonaws.com";
const MYSQL_DB_PASSWORD = "my_password_2020";
const MYSQL_DB_NAME = "mysql";

const PG_DB_USER = "pgadmin";
const PG_DB_HOST = "atlas-postgres.cluster-cx422ywmsto6.us-east-2.rds.amazonaws.com";
const PG_DB_PASSWORD = "my_password_2020";
const PG_DB_NAME = "postgres";

describe("simple-mysql", () => {
  it("mysql", async () => {
    console.log("Creating new connection");

    const client = new AwsMySQLClient({
      // const client = createConnection({
      user: "admin",
      password: "my_password_2020",
      host: MYSQL_DB_HOST,
      database: MYSQL_DB_NAME,
      port: 3306,
      plugins: "readWriteSplitting"
      // ssl: {
      //   ca: readFileSync(
      //     "<path-to>/rds-ca-2019-root.pem"
      //   ).toString()
      // }
    });

    const test = client.connect();

    const res0 = await client.query({ sql: "SELECT @@aurora_server_id" });
    await client.setReadOnly(true);
    const res = await client.query({ sql: "SELECT @@aurora_server_id" });
    await client.setReadOnly(false);
    await client.end();

    console.log("should reach");
  }, 300000);
});
describe("simple-pg", () => {
  it("wrapper", async () => {
    const client = new AwsPGClient({
      user: PG_DB_USER,
      password: PG_DB_PASSWORD,
      host: PG_DB_HOST,
      database: PG_DB_NAME,
      port: 5432,
      plugins: "readWriteSplitting,failover"
    });
    client.on("error", (err: any) => {
      console.log(err);
    });
    await client.connect();
    let res;

    res = await client.query("SELECT pg_sleep(600)");

    await client.setReadOnly(false);
    res = await client.query("select * from aurora_db_instance_identifier()");
    console.log("AFTER");

    await client.end();
  }, 900000);
});
