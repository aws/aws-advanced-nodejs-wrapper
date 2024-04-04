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

import { ExecutionTimePlugin } from "aws-wrapper-common-lib/lib/plugins/execution_time_plugin";
import { sleep } from "aws-wrapper-common-lib/lib/utils/utils";
import { logger } from "aws-wrapper-common-lib/logutils";
import { Writable } from "stream";
import winston from "winston";

const mockCallable = jest.fn();
const timeToSleepMs = 1000;

describe("executionTimePluginTest", () => {
  it("test_executeTime", async () => {
  mockCallable.mockImplementation(async () => {
    await sleep(timeToSleepMs);
    return null;
  });
  
  const plugin = new ExecutionTimePlugin();

  await plugin.execute("query", mockCallable, []);

  // Convert ms to ns
  expect(ExecutionTimePlugin.getTotalExecutionTime()).toBeGreaterThan(timeToSleepMs * 1000000);

  await plugin.execute("query", mockCallable, []);

  expect(ExecutionTimePlugin.getTotalExecutionTime()).toBeGreaterThan(timeToSleepMs * 1000000 * 2);

  ExecutionTimePlugin.resetExecutionTime();
  expect(ExecutionTimePlugin.getTotalExecutionTime()).toEqual(0n);
  });
});