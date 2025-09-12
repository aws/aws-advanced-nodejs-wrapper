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

import { AwsPGClient } from "../../pg";
import { ErrorSimulatorManager, DeveloperConnectionPlugin, ErrorSimulator, ErrorSimulatorMethodCallback } from "../../index";

const postgresHost = "db-identifier.XYZ.us-east-2.rds.amazonaws.com";
const username = "john_smith";
const password = "password";
const database = "employees";
const port = 5432;

const errorToRaise = new Error("test");

const client = new AwsPGClient({
  // Configure connection parameters.
  host: postgresHost,
  port: port,
  user: username,
  password: password,
  database: database,
  plugins: "dev"
});

// Simulate an error while opening a new connection.
ErrorSimulatorManager.raiseErrorOnNextConnect(errorToRaise);

// Attempt connection. Throws errorToRaise.
try {
  await client.connect();
} catch {
  // Handle errorToRaise.
}

// Another connection. Goes normal with no error.
await client.connect();

// Simulate an error with already opened connection.
const simulator: ErrorSimulator = client.getPluginInstance<ErrorSimulator>(DeveloperConnectionPlugin);
simulator.raiseErrorOnNextCall(errorToRaise, "query");

// Query throws errorToRaise.
try {
  const result = await client.query("select 1");
} catch {
  // Handle errorToRaise.
}

// Query executes normally without error.
const anotherResult = await client.query("select 1");

// Check call parameters to decide whether to return an error or not.
class TestErrorCallback implements ErrorSimulatorMethodCallback {
  getErrorToRaise<T>(methodName: string, methodArgs: any): Error | null {
    if (methodName == "query" && methodArgs == "select 1") {
      return errorToRaise;
    }
    return null;
  }
}

simulator.setCallback(new TestErrorCallback());

// Queries that do not match the parameters will execute normally.
const mismatch = await client.query("select 2");

// Query throws errorToRaise.
try {
  const match = await client.query("select 1");
} catch {
  // Handle errorToRaise.
}

// Close connection.
await client.end();
