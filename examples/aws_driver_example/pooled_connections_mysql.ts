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
import { FailoverSuccessError } from "../../common/lib/utils/errors";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { AwsPoolConfig } from "../../common/lib/aws_pool_config";
import { AwsMysqlPoolClient } from "../../mysql/lib/mysql_pool_client";
import { PoolClientWrapper } from "../../common/lib/pool_client_wrapper";
import { PluginManager } from "../../common/lib";

const mysqlHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const username = "john_smith";
const password = "employees";
const database = "database";
const port = 3306;

// Create the AwsMySQLClient and required properties.
const props = {
  host: mysqlHost,
  port: port,
  user: username,
  password: password,
  database: database,
  plugins: "failover, efm2"
};
const client = new AwsMySQLClient(props);
const propertyMap = client.properties;

// Generate the pool of connections using the same properties.
const poolConfig = new MySQL2DriverDialect().preparePoolClientProperties(propertyMap, new AwsPoolConfig({}));
const pool = new AwsMysqlPoolClient(poolConfig);

// Create a custom targetClient from the pool and assign it to the AwsMySQLClient.
const poolClientWrapper = new PoolClientWrapper(await pool.connect(), null, propertyMap);
client.targetClient = poolClientWrapper;

// Connect and query as normal. The client will be connected to the connection from the pool.
await client.connect();
const initialWriter = await client.query({ sql: "SELECT @@aurora_server_id" });
console.log("Initial writer: ", initialWriter[0][0]["@@aurora_server_id"]);

// Additional connections and clients can be made from the pool.
const client2 = new AwsMySQLClient(props);
client2.targetClient = new PoolClientWrapper(await pool.connect(), null, propertyMap);

// Connect, query and close client2 as usual.
await client2.connect();
const result = await client.query({ sql: "SELECT @@aurora_server_id" });
console.log("Connected to instance: ", result[0][0]["@@aurora_server_id"]);
await client2.end();

// Currently plugins that involve a connection change within the pool are not supported.
// Example: the failover plugin connects to a new writer instance.
try {
  // While this query is executing, trigger failover.
  await client.query({ sql: "select sleep(100000)" });
} catch (e) {
  if (e instanceof FailoverSuccessError) {
    console.log(e.message);
    const newWriter = await client.query({ sql: "SELECT @@aurora_server_id" });
    console.log("New writer: ", newWriter[0][0]["@@aurora_server_id"]);

    // The client is no longer connected to the pool connection. These are now different.
    console.log("Pool connection: ", poolClientWrapper.id);
    console.log("Client connection: ", client.targetClient.id);

    // Because they are different, the pool connection needs to be closed separately.
    await poolClientWrapper.end();
  }
} finally {
  await client.end();

  // Clean up the pool and any additional resources.
  await pool.end();
  await PluginManager.releaseResources();
}
