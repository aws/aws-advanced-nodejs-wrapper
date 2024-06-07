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
import { add, complete, cycle, save, suite } from "benny";
import { Client } from "pg";
import { AwsPGClient } from "../pg/lib";
import { AwsMySQLClient } from "../mysql/lib";
import { createConnection } from "mysql2";

dotenv.config();

const PG_DB_USER = process.env.PG_DB_USER;
const PG_DB_HOST = process.env.PG_DB_HOST;
const PG_DB_PASSWORD = process.env.PG_DB_PASSWORD;
const PG_DB_NAME = process.env.PG_DB_NAME;
const MYSQL_DB_USER = process.env.MYSQL_DB_USER;
const MYSQL_DB_HOST = process.env.MYSQL_DB_HOST;
const MYSQL_DB_PASSWORD = process.env.MYSQL_DB_PASSWORD;
const MYSQL_DB_NAME = process.env.MYSQL_DB_NAME;

const pgClient = new Client({
  user: PG_DB_USER,
  host: PG_DB_HOST,
  database: PG_DB_NAME,
  password: PG_DB_PASSWORD,
  port: 5432
});

const mysqlClient = createConnection({
  user: MYSQL_DB_USER,
  host: MYSQL_DB_HOST,
  database: MYSQL_DB_NAME,
  password: MYSQL_DB_PASSWORD,
  port: 3306
});

const pgWrapperClient = new AwsPGClient({
  user: PG_DB_USER,
  host: PG_DB_HOST,
  database: PG_DB_NAME,
  password: PG_DB_PASSWORD,
  port: 5432
});

const mysqlWrapperClient = new AwsMySQLClient({
  user: MYSQL_DB_USER,
  host: MYSQL_DB_HOST,
  database: MYSQL_DB_NAME,
  password: MYSQL_DB_PASSWORD,
  port: 3306
});

pgClient.connect();
pgWrapperClient.connect();
mysqlClient.connect();
mysqlWrapperClient.connect();

suite(
  "Benchmarks",

  add("pg baseline", async () => {
    await pgClient.query("select 1");
  }),

  add("pg execute pipeline", async () => {
    await pgWrapperClient.query("select 1");
  }),

  add("mysql baseline", () => {
    mysqlClient.query("select 1");
  }),

  add("mysql execute pipeline", async () => {
    await mysqlWrapperClient.query({ sql: "select 1" });
  }),

  cycle(),
  complete(async () => {
    await pgClient.end();
    await pgWrapperClient.end();
    mysqlClient.end();
    await mysqlWrapperClient.end();
  }),
  save({ file: "benchmarks", format: "json", details: true }),
  save({ file: "benchmarks", format: "chart.html", details: true })
);
