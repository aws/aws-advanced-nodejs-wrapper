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

import { HostChangeOptions } from "aws-wrapper-common-lib/lib/host_change_options";
import { OldConnectionSuggestionAction } from "aws-wrapper-common-lib/lib/old_connection_suggestion_action";
import { PluginManager } from "aws-wrapper-common-lib/lib/plugin_manager";
import { DefaultPlugin } from "aws-wrapper-common-lib/lib/plugins/default_plugin";
import { AwsPGClient } from "pg-wrapper";
import { mock } from "ts-mockito";

const mockClient: AwsPGClient = mock(AwsPGClient);

const user = "user";
const password = "password";
const host = "test";
const database = "postgres";

const client = new AwsPGClient({
  user: user,
  password: password,
  host: host,
  database: database,
  port: 5432
});

describe("notificationPipelineTest", () => {
  it("test_notifyConnectionChangedReturn", async () => {
    const plugin = new DefaultPlugin();
    const mockChanges = new Set<HostChangeOptions>();
    const suggestion = plugin.notifyConnectionChanged(mockChanges);

    expect(suggestion).toBe(OldConnectionSuggestionAction.NO_OPINION);
  });
  it("test_notifyHostListChangedConnect", async () => {
    const spy = jest.spyOn(PluginManager.prototype, "notifyHostListChanged").mockReturnValue();

    // Supposed to fail
    try {
      await client.connect();
    } catch (e) {
      // do nothing
    }

    await mockClient.end();

    expect(spy).toHaveBeenCalled();
  });
});
