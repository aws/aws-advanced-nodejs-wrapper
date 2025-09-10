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
const idpEndpoint = "123456789.okta.com";
const appId = "abc12345678";
const iamRoleArn = "arn:aws:iam::123456789:role/OktaAccessRole";
const iamIdpArn = "arn:aws:iam::123456789:saml-provider/OktaSAMLIdp";
const iamRegion = "us-east-1";
const idpUsername = "jsmith";
const idpPassword = "password";
const dbUser = "john_smith";

const client = new AwsMySQLClient({
  // Enable Okta authentication and configure connection parameters.
  host: mysqlHost,
  idpEndpoint: idpEndpoint,
  appId: appId,
  iamRoleArn: iamRoleArn,
  iamIdpArn: iamIdpArn,
  iamRegion: iamRegion,
  idpUsername: idpUsername,
  idpPassword: idpPassword,
  dbUser: dbUser,
  plugins: "okta",
  ssl: {
    ca: readFileSync("path/to/ssl/certificate.pem").toString()
  }
});

// Attempt connection.
try {
  await client.connect();
  const result = await client.query({ sql: "select 1" });
  console.log(result);
} finally {
  await client.end();
}
