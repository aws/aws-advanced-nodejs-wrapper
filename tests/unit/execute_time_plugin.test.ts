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

import { ExecuteTimePlugin } from "../../common/lib/plugins/execute_time_plugin";
import { sleep } from "../../common/lib/utils/utils";

const mockCallable = jest.fn();
const timeToSleepMs = 1000;
const acceptableTimeMs = 995;
const acceptableTimeNs = acceptableTimeMs * 1000000;

describe("executeTimePluginTest", () => {
  it("test_executeTime", async () => {
    mockCallable.mockImplementation(async () => {
      await sleep(timeToSleepMs);
      return null;
    });

    const plugin = new ExecuteTimePlugin();

    await plugin.execute("query", mockCallable, []);

    expect(ExecuteTimePlugin.getTotalExecuteTime()).toBeGreaterThan(acceptableTimeNs);

    await plugin.execute("query", mockCallable, []);

    expect(ExecuteTimePlugin.getTotalExecuteTime()).toBeGreaterThan(acceptableTimeNs * 2);

    ExecuteTimePlugin.resetExecuteTime();
    expect(ExecuteTimePlugin.getTotalExecuteTime()).toEqual(0n);
  });
});
