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
import { readFileSync } from "fs";
import { AwsMySQLClient } from "mysql-wrapper/lib/client";
import { AwsPGClient } from "pg-wrapper/lib/client";
import fetch from "node-fetch";
import https from "https";
import axios from "axios";
import qs from "querystring";

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

describe("fedauth", () => {
  it("test", async () => {
    const client = new AwsPGClient({
      // const client = new Client({
      host: "database-pg.cluster-cwpu2jclcwdc.us-east-2.rds.amazonaws.com",
      database: "postgres",
      port: 5432,
      plugins: "federatedAuth",
      idpUsername: "annabanana@teamatlas.example.com",
      idpPassword: "my_password_2020",
      dbUser: "jane_doe",
      iamRegion: "us-east-2",
      iamIdpArn: "arn:aws:iam::346558184882:saml-provider/adfs_teamatlas_example",
      iamRoleArn: "arn:aws:iam::346558184882:role/adfs_teamatlas_example_iam_role",
      idpEndpoint: "ec2amaz-ei6psoj.teamatlas.example.com",
      idpName: "adfs",
      user: "jane_doe",

      ssl: {
        ca: readFileSync(
            "tests/integration/host/src/test/resources/global-bundle.pem",
          )
          .toString(),
      },

      // ssl: {
      //   ca: readFileSync(
      //     "<path-to>/rds-ca-2019-root.pem"
      //   ).toString()
      // }
    });

    await client.connect();

    try {
      // const res = await client.query("SELECT pg_sleep(60)");
      // const res = await client.query("select * from aurora_db_instance_identifier()");
      const res = await client.query("select 1");
      console.log(res);
    } catch (error) {
      console.error(error);
      const res = await client.query("select * from aurora_db_instance_identifier()");
      console.log(res.rows);
    }

    await client.end();
  }, 100000);
});

describe("axios", () => {
  it("axios", async () => {
    const httpsAgent = new https.Agent({
      // rejectUnauthorized: false,
      ca: readFileSync("tests/integration/host/src/test/resources/rds-ca-2019-root.pem").toString()
    });

    const axios = require("axios");
    const qs = require("qs");
    let data = qs.stringify({
      UserName: "annabanana@teamatlas.example.com",
      Password: "my_password_2020"
    });

    let cookie = "";

    let getConfig = {
      method: "get",
      maxBodyLength: Infinity,
      url: "https://ec2amaz-ei6psoj.teamatlas.example.com:443/adfs/ls/IdpInitiatedSignOn.aspx?loginToRp=urn:amazon:webservices&client-request-id=07a266ee-6dc1-4c6d-b200-0080040000c4",
      httpsAgent,
    };

    try {
      const resp = await axios.request(getConfig, {withCredentials: true});
      cookie = resp.headers['set-cookie']
      // console.log(JSON.stringify(resp.data));
    } catch (e) {
      console.log(e);
    }

    let postConfig = {
      method: "post",
      maxBodyLength: Infinity,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // "Cookie": cookie
      },
      url: "https://ec2amaz-ei6psoj.teamatlas.example.com:443/adfs/ls/IdpInitiatedSignOn.aspx?loginToRp=urn:amazon:webservices&client-request-id=07a266ee-6dc1-4c6d-b200-0080040000c4",
      httpsAgent,
      maxRedirects: 0,
      data: data,
      withCredentials: true,
    };

    try {
      const resp = await axios.request(postConfig, {withCredentials: true});
      cookie = resp.headers['set-cookie'];
      console.log(JSON.stringify(resp.data));
    } catch (e: any) {
      cookie = e.response.headers['set-cookie'];
      const url = e.response.headers.location;
      let redirectConfig = {
        maxBodyLength: Infinity,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          "Cookie": cookie
        },
        httpsAgent,
        withCredentials: true,
      };
      const resp2 = await axios.post(url, data, redirectConfig);
      cookie = resp2.headers['set-cookie'];
      console.log(JSON.stringify(resp2.data));
    }
  });
});

describe("fetch", () => {
  it("fetch", async () => {
    const httpsAgent = new https.Agent({
      // rejectUnauthorized: false,
      ca: readFileSync("tests/integration/host/src/test/resources/rds-ca-2019-root.pem").toString()
    });
    const body = new URLSearchParams({
      UserName: "annabanana@teamatlas.example.com",
      Password: "my_password_2020",
      Kmsi: "true",
      AuthMethod: "FormsAuthentication"
    });

    let a = body.toString();

    let resp = await fetch(
      "https://ec2amaz-ei6psoj.teamatlas.example.com:443/adfs/ls/IdpInitiatedSignOn.aspx?loginToRp=urn:amazon:webservices&client-request-id=6d67ba1d-4ede-45a4-8000-0080020000ff",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          charset: "UTF-8"
          // "Cookie": "MSISSamlRequest=QmFzZVVybD1odHRwcyUzYSUyZiUyZmVjMmFtYXotZWk2cHNvai50ZWFtYXRsYXMuZXhhbXBsZS5jb20lMmZhZGZzJTJmbHMlMmZcU0FNTFJlcXVlc3Q9bFpMUlM4TXdFTWIlMmZsWkwzTkczWDFTMTBoYkx0b2VKUXB2aXdGOG5TSzR1MFNlMmxPdnpyVFRaMGlERHdMWGZjZDklMmYzTzVLajZOcWVsNk05NkMyOGpZQTJxRllMOHRKQWxrRlR6JTJia01aZ2xOWlRPbklwc0NuY1RwTkxxWmlYMmN6VW53REFNcW94Y2tDU01TVklnalZCcXQwTmExb2lTbDBaVEc4Vk0wNFZIS0oxa1lKOUdPQkN2bm9yU3dKJTJiWEIyaDQ1WXlBVDBZbFBDaXJyMGJ5R0ZseHBXNEVoSEVYWHR4QkswekZSTjhoYVpDUllHbzNnZmNaQmN5TlFJZGVpQSUyYlJXOHNkeWM4ZGRKQzdQUTN6VTJJTlVqWUthQk1ldTFjaFA0TmZWJTJmV0Nza2FZbFJYNUNHODdTNnlLQkNJTkhJNFZIYzJUclpWSnV5aDFkVjluRDQlMmYzdE5USW5mVmNTa05saFJKdXpzMjJSTzloYSUyYmFYNHp3aDVPZFlLdElTdHUlMmZtZ3BPOWVtb1hmNHE5dU5QJTJiQSUyZmJkN3puNEdMczlmQzlnbGtDdiUyYiUyZnFIaUN3JTNkJTNkXFByb3RvY29sQmluZGluZz11cm4lM2FvYXNpcyUzYW5hbWVzJTNhdGMlM2FTQU1MJTNhMi4wJTNhYmluZGluZ3MlM2FIVFRQLVJlZGlyZWN0XFNpZ25hdHVyZT1WSHZNTkxQcnElMmJJMkx3QnhITGROckg3Wk1YdyUyZm41bUN5VUhia3pIV0w2Z0xERFlxR2V3T2FsdSUyYk93ZDVhYXVGWXNUR2tuT2dpUXdnZGtCb3ZZNSUyZk4lMmIyV21sQzZFN3hpYzFOU21XaFNaY1d3UVVDOTVHZVJmMUp0UDFWMzI4JTJiclgyQnBOQnJra3EwZXBMNWxkbnZHc1dyMDRuJTJmOTE0Mks5TXRMRHZWTEZuMDc4WE44RXB2c0pNdmlnblQ2MFhBJTJmdG9nJTJmUmJ0N1dRM25FSDRTYlBiYjlMNTlVRm80MVBGbzlHT2xCN2lsJTJiMkNab3FtSldmUmtWNlpFWFRVZTR2UDB3Nm55Z1lsWnczWDVUR2VYQkgyakJMOFclMmZidEZlVzFJUTF5cHRocVdLRWNzVWlnQzBnSSUyYkRiTFNDZmdkRHBlN1pQZ2VJcjIyNGZhM0xuYXdPaUclMmZ0ZyUzZCUzZFxTaWdBbGc9aHR0cCUzYSUyZiUyZnd3dy53My5vcmclMmYyMDAxJTJmMDQlMmZ4bWxkc2lnLW1vcmUlMjNyc2Etc2hhMjU2XFF1ZXJ5U3RyaW5nSGFzaD11eVhNSVRUMWZCVjBPTEdSQm5UdWcwZWR2ayUyYmFLUFd1dHF6OElZbXdOUmslM2Q="
        },
        agent: httpsAgent
      }
    );
    console.log(resp.headers);
    const text = await resp.text();
    console.log(text);
    const header = resp.headers.get("set-cookie");
    if (header) {
      resp = await fetch("https://ec2amaz-ei6psoj.teamatlas.example.com:443/adfs/ls/IdpInitiatedSignOn.aspx?loginToRp=urn:amazon:webservices&client-request-id=6d67ba1d-4ede-45a4-8000-0080020000ff", {
        method: "POST",
        body: new URLSearchParams({
          'username': 'annabanana@teamatlas.example.com',
          'password': 'my_password_2020',
          'authmethod': 'FormsAuthentication'
        }),
        headers: {
          "Content-Type": "Application/x-www-form-urlencoded",
          },
        agent: httpsAgent
      });
      // console.log(`---`)

      const text = await resp.text();
      // console.log(resp.headers)

      if (resp.status / 100 != 2) {
        console.log(resp);
      }
      // console.log(text);
    }
  });
});

// describe("failover", () => {
//   it("failovertest", async () => {
//     const client = new AwsPGClient({
//       // const client = new Client({
//       user: PG_DB_USER,
//       password: PG_DB_PASSWORD,
//       host: PG_DB_HOST,
//       database: PG_DB_NAME,
//       port: 5432,
//       plugins: "failover"
//       // ssl: {
//       //   ca: readFileSync(
//       //     "<path-to>/rds-ca-2019-root.pem"
//       //   ).toString()
//       // }
//     });
//     let count = 0;

//     await client.connect();

//     while (true) {
//       try {
//         const res = await client.query("select * from aurora_db_instance_identifier()");
//         console.log(count);
//         count++;
//       } catch (error) {
//         console.log(error);
//         break;
//       }
//       await sleep(10000);
//     }

//     await client.end();
//   }, 100000);
// });
