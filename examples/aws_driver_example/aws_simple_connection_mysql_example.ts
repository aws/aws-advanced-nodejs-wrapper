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

import { AwsMySQLClient } from "../../mysql/lib";

const mysqlHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const username = "john_smith";
const password = "password";
const port = 3306;

const client = new AwsMySQLClient({
  // Configure connection parameters.
  host: mysqlHost,
  port: port,
  user: username,
  password: password
});

// Attempt connection.
try {
  await client.connect();
  const result = await client.query({ sql: "SELECT @@aurora_server_id" });
  console.log(result);
} finally {
  await client.end();
}
