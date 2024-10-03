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
import { AwsPGClient } from "../../pg/lib";

const postgresHost = "postgresql://db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const idpEndpoint = "123456789.okta.com";
const iamRoleArn = "arn:aws:iam::123456789:role/OktaAccessRole";
const iamIdpArn = "arn:aws:iam::123456789:saml-provider/OktaSAMLIdp";
const iamRegion = "us-east-1";
const idpUsername = "jsmith";
const idpPassword = "password";
const dbUser = "john_smith";
const database = "employees";

const client = new AwsPGClient({
  // Enable AWS Federated authentication and configure connection parameters.
  host: postgresHost,
  database: database,
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
  // Optional: The httpsAgentOptions property adds parameters to the httpsAgent that connects to the hosting URL.
  // For more information see: https://nodejs.org/api/https.html#class-httpsagent
  // Option 1: Disable server side SSL verification.
  /* httpsAgentOptions: {
   rejectUnauthorized: false
  } */
  // Option 2: Provide certificates for authentication.
  /* httpsAgentOptions: {
   cert: fs.readFileSync("./usercert.pem"),
   key: fs.readFileSync("./key.pem"),
  } */
});

// Attempt connection.
try {
  await client.connect();
  const result = await client.query("select 1");
  console.log(result);
} finally {
  await client.end();
}
