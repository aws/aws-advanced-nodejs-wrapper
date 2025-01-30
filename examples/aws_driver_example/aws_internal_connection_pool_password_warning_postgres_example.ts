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

import { InternalPooledConnectionProvider } from "../../common/lib/internal_pooled_connection_provider";
import { logger } from "../../common/logutils";
import { AwsPGClient } from "../../pg/lib";
import { PluginManager } from "../../common/lib";

const postgresHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const username = "john_smith";
const correctPassword = "correct_password";
const wrongPassword = "wrong_password";
const database = "database";
const port = 5432;

/**
 * Configure read-write splitting to use internal connection pools (the pool config and mapping
 * parameters are optional, see UsingTheReadWriteSplittingPlugin.md for more info).
 */
const provider = new InternalPooledConnectionProvider();

const client = new AwsPGClient({
  host: postgresHost,
  port: port,
  user: username,
  password: correctPassword,
  database: database,
  plugins: "readWriteSplitting",
  connectionProvider: provider
});

// Create an internal connection pool with the correct password
try {
  await client.connect();
  const result = await client.query("SELECT 1");
  console.log(result);
} finally {
  // Finished with connection. The connection is not actually closed here, instead it will be
  // returned to the pool but will remain open
  await client.end();
}

const newClient = new AwsPGClient({
  host: postgresHost,
  port: port,
  user: username,
  password: wrongPassword,
  database: database,
  plugins: "readWriteSplitting"
});

// Even though we use the wrong password, the original connection will be returned by the
// pool and we can still use it.
try {
  await newClient.connect();
  const result = await newClient.query("SELECT 1");
  console.log(result);
} finally {
  await newClient.end();
}

// Closes all pools and removes all cached pool connections.
await provider.releaseResources();

const newClient2 = new AwsPGClient({
  host: postgresHost,
  port: port,
  user: username,
  password: wrongPassword,
  database: database,
  plugins: "readWriteSplitting"
});

// Correctly throws an error - creates a fresh connection pool which will check the password
// because there are no cached pool connections.
try {
  await newClient2.connect();
  // Will not reach - error will be thrown.
} finally {
  // Clean up resources used by the plugins.
  await PluginManager.releaseResources();

  logger.debug("example complete");
}
