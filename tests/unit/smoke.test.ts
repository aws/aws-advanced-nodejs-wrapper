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

import dotenv from "dotenv";
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

// describe("simple-pg", () => {
//   it("wrapper", async () => {
//     const client = new AwsPGClient({
//       // const client = new Client({
//       user: PG_DB_USER,
//       password: PG_DB_PASSWORD,
//       host: PG_DB_HOST,
//       database: PG_DB_NAME,
//       port: 5432,
//       plugins: "federatedAuth"
//       // ssl: {
//       //   ca: readFileSync(
//       //     "<path-to>/rds-ca-2019-root.pem"
//       //   ).toString()
//       // }
//     });

//     await client.connect();

//     try {
//       // const res = await client.query("SELECT pg_sleep(60)");
//       const res = await client.query("select * from aurora_db_instance_identifier()");
//       // const res = await client.query("select 1");
//     } catch (error) {
//       console.error(error);
//       const res = await client.query("select * from aurora_db_instance_identifier()");
//       console.log(res.rows);
//     }

//     await client.end();
//   }, 100000);
// });

describe("iamtest", () => {
  it("test", async () => {
    // const ip = await promisify(lookup)("atlas-postgres-instance-3.czygpppufgy4.us-east-2.rds.amazonaws.com", {});
    const client = new AwsPGClient({
      // const client = new Client({
      host: "atlas-postgres-instance-3.czygpppufgy4.us-east-2.rds.amazonaws.com",
      database: "postgres",
      port: 5432,
      plugins: "iam",
      // iamHost: "atlas-postgres-instance-3.czygpppufgy4.us-east-2.rds.amazonaws.com",
      // idpUsername: "annabanana@teamatlas.example.com",
      // idpPassword: "my_password_2020",
      // dbUser: "jane_doe",
      // iamRegion: "us-east-2",
      // iamIdpArn: "arn:aws:iam::346558184882:saml-provider/adfs_teamatlas_example",
      // iamRoleArn: "arn:aws:iam::346558184882:role/adfs_teamatlas_example_iam_role",
      // idpEndpoint: "ec2amaz-ei6psoj.teamatlas.example.com",
      // idpName: "adfs",
      user: "WRONG_IAM_USER"

      // ssl: {
      //   ca: readFileSync("tests/integration/host/src/test/resources/global-bundle.pem").toString()
      // }
    });

    client.on("error", (error: any) => {
      console.log(error);
    });

    try {
      // TODO: error not being caught?
      await client.connect();
      // throw new Error("Error did not occur");
    } catch (err) {
      // ignore error
      console.error(err);
      console.log("banana");
    }

    // try {
    // const res = await client.query("SELECT pg_sleep(60)");
    // const res = await client.query("select now()");
    // const res = await client.query("select 1");
    // console.log(res);
    // } catch (error) {
    // console.log(error);
    // const res = await client.query("select * from aurora_db_instance_identifier()");
    // console.log(res.rows);
    // }

    await client.end();
  }, 9000000);
});
