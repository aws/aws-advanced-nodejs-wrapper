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
import { add, cycle, suite, save, complete } from "benny";
import pkg from "pg";
const { Client } = pkg;
// import { createConnection } from "mysql2";
import mysql from "mysql2/promise";
import AwsPGClient from "pg-wrapper/lib/client";
import AwsMySQLClient from "mysql-wrapper/lib/client";

dotenv.config();

const PG_DB_USER = process.env.PG_DB_USER;
const PG_DB_HOST = process.env.PG_DB_HOST;
const PG_DB_PASSWORD = process.env.PG_DB_PASSWORD;
const PG_DB_NAME = process.env.PG_DB_NAME;
const MYSQL_DB_USER = process.env.MYSQL_DB_USER;
const MYSQL_DB_HOST = process.env.MYSQL_DB_HOST;
const MYSQL_DB_PASSWORD = process.env.MYSQL_DB_PASSWORD;
const MYSQL_DB_NAME = process.env.MYSQL_DB_NAME;

suite(
  "Connect Benchmarks",

  // pass
  add("pg baseline", async () => {
    const pgClient = new Client({
      user: PG_DB_USER,
      host: PG_DB_HOST,
      database: PG_DB_NAME,
      password: PG_DB_PASSWORD,
      port: 5432
    });
    await pgClient.connect();
    await pgClient.end();
  }),

  // pass with query only
  add("pg connect pipeline", async () => {
    const wrapperClient = new AwsPGClient({
      user: PG_DB_USER,
      host: PG_DB_HOST,
      database: PG_DB_NAME,
      password: PG_DB_PASSWORD,
      port: 5432
    });
    await wrapperClient.connect();
    await wrapperClient.end();
  }),

  // pass
  add("mysql baseline", async () => {
    const mysqlClient = await mysql.createConnection({
      user: MYSQL_DB_USER,
      host: MYSQL_DB_HOST,
      database: MYSQL_DB_NAME,
      password: MYSQL_DB_PASSWORD,
      port: 3306
    });
    await mysqlClient.connect();
    await mysqlClient.end();
  }),

  // pass
  add("mysql connect pipeline", async () => {
    const mysqlWrapperClient = new AwsMySQLClient({
      user: MYSQL_DB_USER,
      host: MYSQL_DB_HOST,
      database: MYSQL_DB_NAME,
      password: MYSQL_DB_PASSWORD,
      port: 3306
    });
    await mysqlWrapperClient.connect();
    await mysqlWrapperClient.end();
  }),

  cycle(),
  complete(),
  save({ file: "connect_benchmarks", format: "json", details: true }),
  save({ file: "connect_benchmarks", format: "chart.html", details: true })
);
