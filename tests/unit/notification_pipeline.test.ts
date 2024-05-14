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
import { PluginServiceManagerContainer } from "aws-wrapper-common-lib/lib/plugin_service_manager_container";
import { DefaultPlugin } from "aws-wrapper-common-lib/lib/plugins/default_plugin";
import { mock } from "ts-mockito";

class TestPlugin extends DefaultPlugin {
  counter: number = 0;

  notifyConnectionChanged(changes: Set<HostChangeOptions>): OldConnectionSuggestionAction {
    this.counter++;
    return OldConnectionSuggestionAction.NO_OPINION;
  }

  notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): void {
    this.counter++;
    return;
  }

  resetCounter() {
    this.counter = 0;
  }
}

const container: PluginServiceManagerContainer = new PluginServiceManagerContainer();
const props: Map<string, any> = mock(Map<string, any>);
const hostListChanges: Map<string, Set<HostChangeOptions>> = mock(Map<string, Set<HostChangeOptions>>);
const connectionChanges: Set<HostChangeOptions> = mock(Set<HostChangeOptions>);

describe("notificationPipelineTest", () => {
  let pluginManager: PluginManager;
  let plugin: TestPlugin;

  beforeEach(() => {
    pluginManager = new PluginManager(container, props);
    plugin = new TestPlugin();
    pluginManager["_plugins"] = [plugin];
  });

  it("test_notifyConnectionChanged", async () => {
    const result: Set<OldConnectionSuggestionAction> = await pluginManager.notifyConnectionChanged(connectionChanges, null);
    expect(plugin.counter).toBe(1);
    expect(result).toBeTruthy();
    expect(result.size).toBe(1);
  });

  it("test_notifyHostListChanged", async () => {
    await pluginManager.notifyHostListChanged(hostListChanges);
    expect(plugin.counter).toBe(1);
  });
});
