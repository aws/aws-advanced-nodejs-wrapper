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

import { PluginService } from "../../common/lib/plugin_service";
import { instance, mock } from "ts-mockito";
import { DeveloperConnectionPlugin } from "../../common/lib/plugins/dev/developer_connection_plugin";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { AwsPGClient } from "../../pg/lib";
import { IamAuthenticationPlugin } from "../../common/lib/authentication/iam_authentication_plugin";

class DevPluginTest extends DeveloperConnectionPlugin {
  testMethod() {
    return "test";
  }
}

class TestClient extends AwsPGClient {
  setManager() {
    this.pluginManager.init([plugin]);
  }
}

const mockPluginService = mock(PluginService);
const mockRdsUtils = mock(RdsUtils);
const properties: Map<string, any> = new Map();

const plugin = new DevPluginTest(instance(mockPluginService), properties, instance(mockRdsUtils), undefined, undefined, undefined);
const testClient = new TestClient({ plugins: "dev" });
testClient.setManager();

describe("testGetPluginInstance", () => {
  it("testGetPluginInstanceSameType", async () => {
    const devPluginTest: DevPluginTest = testClient.getPluginInstance<DevPluginTest>(DeveloperConnectionPlugin);
    expect(devPluginTest).toEqual(plugin);

    expect(devPluginTest.testMethod()).toEqual("test");
  });

  it("testGetPluginInstanceAndAssertType", async () => {
    const developerPlugin: DeveloperConnectionPlugin = testClient.getPluginInstance<DeveloperConnectionPlugin>(DeveloperConnectionPlugin);
    expect(developerPlugin).toEqual(plugin);
  });

  it("testGetInstanceWithWrongType", async () => {
    try {
      testClient.getPluginInstance(IamAuthenticationPlugin);
      throw new Error("Retrieved plugin instance of wrong type.");
    } catch (error: any) {
      expect(error.message).toEqual("Unable to retrieve plugin instance.");
    }
  });
});
