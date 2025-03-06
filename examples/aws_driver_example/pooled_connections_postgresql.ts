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

import { AwsPGClient } from "../../pg/lib";
import { NodePostgresDriverDialect } from "../../pg/lib/dialect/node_postgres_driver_dialect";
import { AwsPoolConfig } from "../../common/lib/aws_pool_config";
import { AwsPgPoolClient } from "../../pg/lib/pg_pool_client";
import { PoolClientWrapper } from "../../common/lib/pool_client_wrapper";
import { PluginManager } from "../../common/lib";

const postgresHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const username = "john_smith";
const password = "employees";
const database = "database";
const port = 5432;

// Create the AwsPGClient and required properties.
const props = {
  host: postgresHost,
  port: port,
  user: username,
  password: password,
  database: database,
  plugins: "readWriteSplitting, efm2"
};
const client = new AwsPGClient(props);
const propertyMap = client.properties;

// Generate the pool of connections using the same properties.
const poolConfig = new NodePostgresDriverDialect().preparePoolClientProperties(propertyMap, new AwsPoolConfig({}));
const pool = new AwsPgPoolClient(poolConfig);

// Create a custom targetClient from the pool and assign it to the AwsPGClient.
const poolClientWrapper = new PoolClientWrapper(await pool.connect(), null, propertyMap);
client.targetClient = poolClientWrapper;

// Connect and query as normal. The client will be connected to the connection from the pool.
await client.connect();
const initialWriter = await client.query("select aurora_db_instance_identifier()");
console.log("Initial writer: ", initialWriter.rows[0]["aurora_db_instance_identifier"]);

// Additional connections and clients can be made from the pool.
const client2 = new AwsPGClient(props);
client2.targetClient = new PoolClientWrapper(await pool.connect(), null, propertyMap);

// Connect, query and close client2 as usual.
await client2.connect();
const result = await client.query("select aurora_db_instance_identifier()");
console.log("Connected to instance: ", result.rows[0]["aurora_db_instance_identifier"]);
await client2.end();

// Currently plugins that involve a connection change within the pool are not supported.
// WARNING: failover with a pooled connection from the node-postgres driver will result in an error
// from the pool's idleListener that is not handled by the wrapper.

// Example: the rw splitting plugin changes the connection to a reader instance.
await client.setReadOnly(true);
const newReader = await client.query("select aurora_db_instance_identifier()");
console.log("New reader: ", newReader.rows[0]["aurora_db_instance_identifier"]);

// The client is no longer connected to the pool connection. These are now different.
console.log("Pool connection: ", poolClientWrapper.id);
console.log("Client connection: ", client.targetClient.id);

// Because they are different, the pool connection needs to be closed separately.
await client.end();
await poolClientWrapper.end();

// Clean up the pool and any additional resources.
await pool.end();
await PluginManager.releaseResources();
