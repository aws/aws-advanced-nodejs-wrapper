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

import { ConnectTimePlugin } from "aws-wrapper-common-lib/lib/plugins/connect_time_plugin";
import { FailoverFailedError, ReadWriteSplittingError } from "aws-wrapper-common-lib/lib/utils/errors";
import { Messages } from "aws-wrapper-common-lib/lib/utils/messages";
import { sleep } from "aws-wrapper-common-lib/lib/utils/utils";
import dotenv from "dotenv";
import { AwsMySQLClient } from "mysql-wrapper/lib/client";
import { AwsPGClient } from "pg-wrapper/lib/client";

dotenv.config();

const MYSQL_DB_USER = process.env.MYSQL_DB_USER;
const MYSQL_DB_HOST = process.env.MYSQL_DB_HOST;
const MYSQL_DB_PASSWORD = process.env.MYSQL_DB_PASSWORD;
const MYSQL_DB_NAME = process.env.MYSQL_DB_NAME;

const PG_DB_USER = process.env.PG_DB_USER;
const PG_DB_HOST = process.env.PG_DB_HOST;
const PG_DB_PASSWORD = process.env.PG_DB_PASSWORD;
const PG_DB_NAME = process.env.PG_DB_NAME;

// describe("simple-mysql", () => {
//   it("mysql", async () => {
//     // console.log("Creating new connection");

//     const client = new AwsMySQLClient({
//       // const client = createConnection({
//       user: MYSQL_DB_USER,
//       password: MYSQL_DB_PASSWORD,
//       host: MYSQL_DB_HOST,
//       database: MYSQL_DB_NAME,
//       port: 3306,
//       plugins: "connectTime"
//       // ssl: {
//       //   ca: readFileSync(
//       //     "<path-to>/rds-ca-2019-root.pem"
//       //   ).toString()
//       // }
//     });

//     await client.connect();
//     // console.log("finished client.connect ?");

//     try {
//       // const res = await client.query({ sql: "SELECT sleep(60)" });
//       const res = await client.query({ sql: "SELECT @@aurora_server_id" });
//       // console.log(res);
//     } catch (error) {
//       console.log(error);
//       const res = await client.query({ sql: "SELECT @@aurora_server_id" }).then((results: any) => {
//         // console.log(client.targetClient);
//         // console.log(JSON.parse(JSON.stringify(results))[0][0]["@@aurora_server_id"]);
//       });
//     }

//     await client.end();
//   }, 300000);
// });

describe("simple-pg", () => {
  it("wrapper", async () => {
    const client = new AwsPGClient({
      // const client = new Client({
      user: PG_DB_USER,
      password: PG_DB_PASSWORD,
      host: PG_DB_HOST,
      database: PG_DB_NAME,
      port: 5432,
      plugins: "federatedAuth"
      // ssl: {
      //   ca: readFileSync(
      //     "<path-to>/rds-ca-2019-root.pem"
      //   ).toString()
      // }
    });

    await client.connect();

    try {
      // const res = await client.query("SELECT pg_sleep(60)");
      const res = await client.query("select * from aurora_db_instance_identifier()");
      // const res = await client.query("select 1");
    } catch (error) {
      console.error(error);
      const res = await client.query("select * from aurora_db_instance_identifier()");
      console.log(res.rows);
    }

    await client.end();
  }, 100000);
});

describe("failover", () => {
  it("failovertest", async () => {
    const client = new AwsPGClient({
      // const client = new Client({
      user: PG_DB_USER,
      password: PG_DB_PASSWORD,
      host: PG_DB_HOST,
      database: PG_DB_NAME,
      port: 5432,
      plugins: "failover"
      // ssl: {
      //   ca: readFileSync(
      //     "<path-to>/rds-ca-2019-root.pem"
      //   ).toString()
      // }
    });
    let count = 0;

    await client.connect();

    while (true) {
      try {
        const res = await client.query("select * from aurora_db_instance_identifier()");
        console.log(count);
        count++;
      } catch (error) {
        console.log(error);
        break;
      }
      await sleep(10000);
    }

    await client.end();
  }, 100000);
});
