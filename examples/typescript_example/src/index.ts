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

import { AwsMySQLClient } from "aws-advanced-nodejs-wrapper/mysql";

async function main(): Promise<void> {
  const mysqlHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
  const username = "john_smith";
  const password = "password";
  const database = "db";
  const port = 3306;

  const config = {
    host: mysqlHost,
    port: port,
    database: database,
    user: username,
    password: password
  };

  const client = new AwsMySQLClient(config);
  try {
    await client.connect();
    const [res, _] = await client.query({ sql: "SELECT @@aurora_server_id as current_id" });
    console.log(`Currently connected to ${res[0].current_id}`);
  } finally {
    await client.end();
  }
}

main();
