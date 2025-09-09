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

import { AwsPGClient } from "aws-advanced-nodejs-wrapper/pg";

async function main() {
  const pgHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
  const username = "john_smith";
  const password = "password";
  const database = "db";
  const port = 5432;

  const config = {
    host: pgHost,
    port: port,
    database: database,
    user: username,
    password: password
  };

  const client = new AwsPGClient(config);

  try {
    await client.connect();
    const result = await client.query("SELECT aurora_db_instance_identifier() as current_id");
    console.log(`Currently connected to ${result.rows[0].current_id}`);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
