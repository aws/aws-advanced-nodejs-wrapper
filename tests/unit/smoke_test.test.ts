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

import { ProxyHelper } from "../integration/container/tests/utils/proxy_helper";
import { TestEnvironment } from "../../dist/integration/container/tests/utils/test_environment";
import { DriverHelper } from "../integration/container/tests/utils/driver_helper";

import { DatabaseEngine } from "../integration/container/tests/utils/database_engine";
import { AuroraTestUtility } from "../integration/container/tests/utils/aurora_test_utility";
import { AwsPGClient } from "../../pg/lib";
import { AwsMySQLClient } from "../../mysql/lib";
import { FailoverSuccessError } from "../../common/lib/utils/errors";

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
      plugins: ""
      // ssl: {
      //   ca: readFileSync(
      //     "<path-to>/rds-ca-2019-root.pem"
      //   ).toString()
      // }
    });

    const test = client.connect();
    await expect(async () => {
      await DriverHelper.executeQuery(DatabaseEngine.MYSQL, client, "select sleep(15)");
    }).rejects.toThrow(FailoverSuccessError);

    await client.end();

    console.log("should reach");
  }, 300000);
});

const auroraTestUtility = new AuroraTestUtility();

describe("simple-pg", () => {
  it("wrapper", async () => {
    const client = new AwsPGClient({
      user: PG_DB_USER,
      password: PG_DB_PASSWORD,
      host: PG_DB_HOST,
      database: PG_DB_NAME,
      port: 5432,
      plugins: "failover,readWriteSplitting",
      query_timeout: 10000
    });

    client.on("error", (err: any) => {
      console.log(err);
    });
    await client.connect();
    let res;
    // res = await client.query("select * from aurora_db_instance_identifier()");
    // console.log(res.rows[0]);

    await client.setReadOnly(true);

    await expect(async () => {
      await DriverHelper.executeQuery(DatabaseEngine.PG, client, "select pg_sleep(15)");
    }).rejects.toThrow(FailoverSuccessError);

    res = await client.query("select * from aurora_db_instance_identifier()");
    console.log(res);

    await client.end();
  }, 900000);
});