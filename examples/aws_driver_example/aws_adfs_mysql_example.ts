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

import { readFileSync } from "fs";
import { AwsMySQLClient } from "../../mysql";

const mysqlHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const idpEndpoint = "ec2amaz-ab3cdef.example.com";
const iamRoleArn = "arn:aws:iam::123456789012:role/adfs_example_iam_role";
const iamIdpArn = "arn:aws:iam::123456789012:saml-provider/adfs_example";
const iamRegion = "us-east-1";
const idpUsername = "someFederatedUsername@example.com";
const idpPassword = "password";
const dbUser = "john_smith";

const client = new AwsMySQLClient({
  // Enable AWS Federated authentication and configure connection parameters.
  host: mysqlHost,
  idpEndpoint: idpEndpoint,
  iamRoleArn: iamRoleArn,
  iamIdpArn: iamIdpArn,
  iamRegion: iamRegion,
  idpUsername: idpUsername,
  idpPassword: idpPassword,
  dbUser: dbUser,
  plugins: "federatedAuth",
  ssl: {
    ca: readFileSync("path/to/ssl/certificate.pem").toString()
  }
  // Optional: Disable server side SSL verification, this is useful when testing in local environments and is not
  // recommended for production. For more information see: https://nodejs.org/api/https.html#class-httpsagent
  /* httpsAgentOptions: {
   rejectUnauthorized: false
  } */
});

// Attempt connection.
try {
  await client.connect();
  const [rows] = await client.query({ sql: "select 1" });
  console.log(rows[0]); // { "1": 1 }
} finally {
  await client.end();
}
