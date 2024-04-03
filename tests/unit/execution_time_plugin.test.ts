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

describe("executionTimePluginTest", () => {
  it("test_executeTime", async () => {
    mockCallable.mockImplementation(() => {
      sleep(10);
      return null;
    })
    
    const plugin = new ExecutionTimePlugin();

    let output = '';
    const stream = new Writable();
    stream._write = (chunk, encoding, next) => {
      output = output += chunk.toString();
      next();
    };

    const streamTransport = new winston.transports.Stream({ stream })
    logger.add(streamTransport);
    logger.level = "debug";

    // Temporarily suppress console logging
    logger.transports[0].silent = true;

    await plugin.execute("query", mockCallable, []);

    logger.transports[0].silent = false;

    const logMessages = output.trim().split('\n');

    expect(logMessages[0]).toContain("Executed query in");
    expect(ExecutionTimePlugin.getTotalExecutionTime()).toBeGreaterThan(0n);

    ExecutionTimePlugin.resetExecutionTime();
    expect(ExecutionTimePlugin.getTotalExecutionTime()).toEqual(0n);
  })
});
