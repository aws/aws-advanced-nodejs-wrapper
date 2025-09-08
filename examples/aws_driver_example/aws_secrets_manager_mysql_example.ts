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

import { AwsMySQLClient } from "../../mysql";

const mysqlHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const port = 3306;
const secretId = "SecretName";
const secretRegion = "us-east-1";
/* secretId can be set as secret ARN instead. The ARN includes the secretRegion */
// const secretId = "arn:aws:secretsmanager:us-east-1:AccountId:secret:SecretName-6RandomCharacters";

const client = new AwsMySQLClient({
  // Enable the AWS Secrets Manager Connection Plugin and configure connection parameters.
  host: mysqlHost,
  port: port,
  secretId: secretId,
  secretRegion: secretRegion,
  plugins: "secretsManager"
});

// Attempt connection.
try {
  await client.connect();
  const [rows] = await client.query({ sql: "SELECT 1" });
  console.log(rows[0]); // { "1": 1 }
} finally {
  await client.end();
}
