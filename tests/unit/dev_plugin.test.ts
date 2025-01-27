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
import { HostInfo } from "../../common/lib/host_info";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { anything, instance, mock, spy, when } from "ts-mockito";
import { DeveloperConnectionPlugin } from "../../common/lib/plugins/dev/developer_connection_plugin";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { ErrorSimulatorMethodCallback } from "../../common/lib/plugins/dev/error_simulator_method_callback";
import { ErrorSimulatorManager } from "../../common/lib/plugins/dev/error_simulator_manager";
import { ErrorSimulatorConnectCallback } from "../../common/lib/plugins/dev/error_simulator_connect_callback";
import { jest } from "@jest/globals";

// Implementations for testing purposes only.
class ErrorSimulatorConnectCallbackImpl implements ErrorSimulatorConnectCallback {
  getErrorToRaise(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean): Error | null {
    return null;
  }
}

class ErrorSimulatorMethodCallbackImpl implements ErrorSimulatorMethodCallback {
  getErrorToRaise(methodName: string, methodArgs: any): Error | null {
    return new Error();
  }
}

const defaultPort = 1234;
const hostInfo = new HostInfo("pg.testdb.us-east-2.rds.amazonaws.com", defaultPort);

const mockPluginService = mock(PluginService);
const mockRdsUtils = mock(RdsUtils);

const properties: Map<string, any> = new Map();
let plugin: DeveloperConnectionPlugin;

const mockConnectFunc = jest.fn(() => {
  return Promise.resolve();
});
const mockFunction = () => {
  return Promise.resolve();
};

const mockConnectCallback: ErrorSimulatorConnectCallback = mock(ErrorSimulatorConnectCallbackImpl);
const mockMethodCallback: ErrorSimulatorMethodCallback = mock(ErrorSimulatorMethodCallbackImpl);

const TEST_ERROR = new Error("test");

describe("testDevPlugin", () => {
  beforeEach(() => {
    properties.set(WrapperProperties.PLUGINS.name, "dev");
    plugin = new DeveloperConnectionPlugin(instance(mockPluginService), properties, instance(mockRdsUtils), undefined, undefined, undefined);
  });

  it("testRaiseError", async () => {
    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;

    await expect(plugin.execute("query", mockFunction, [])).toHaveReturned;

    plugin.raiseErrorOnNextCall(TEST_ERROR);

    await expect(plugin.execute("query", mockFunction, [])).rejects.toEqual(TEST_ERROR);
  });

  it("testRaiseErrorForMethodName", async () => {
    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;

    await expect(plugin.execute("query", mockFunction, [])).toHaveReturned;

    plugin.raiseErrorOnNextCall(TEST_ERROR, "query");

    await expect(plugin.execute("query", mockFunction, [])).rejects.toEqual(TEST_ERROR);
  });

  it("testRaiseErrorForAnyMethodName", async () => {
    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;

    await expect(plugin.execute("query", mockFunction, [])).toHaveReturned;

    plugin.raiseErrorOnNextCall(TEST_ERROR, "*");

    await expect(plugin.execute("query", mockFunction, [])).rejects.toEqual(TEST_ERROR);
  });

  it("testRaiseErrorForWrongMethodName", async () => {
    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;

    await expect(plugin.execute("query", mockFunction, [])).toHaveReturned;

    plugin.raiseErrorOnNextCall(TEST_ERROR, "close");

    await expect(plugin.execute("query", mockFunction, [])).toHaveReturned;
  });

  it("testRaiseErrorWithCallback", async () => {
    plugin.setCallback(instance(mockMethodCallback));

    const mockArgs = ["test", "employees"];
    when(mockMethodCallback.getErrorToRaise("query", mockArgs)).thenThrow(TEST_ERROR);

    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;

    await expect(plugin.execute("query", mockFunction, mockArgs)).rejects.toEqual(TEST_ERROR);

    await expect(plugin.execute("query", mockFunction, ["test", "admin"])).toHaveReturned;
  });

  it("testRaiseNoErrorWithCallback", async () => {
    plugin.setCallback(instance(mockMethodCallback));

    const mockArgs = ["test", "employees"];
    when(mockMethodCallback.getErrorToRaise("query", mockArgs)).thenThrow(TEST_ERROR);

    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;

    await expect(plugin.execute("close", mockFunction, mockArgs)).toHaveReturned;

    await expect(plugin.execute("close", mockFunction, ["test", "admin"])).toHaveReturned;
  });

  it("testRaiseErrorOnConnect", async () => {
    ErrorSimulatorManager.raiseErrorOnNextConnect(TEST_ERROR);

    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc);
      throw new Error("Dev plugin should throw TEST_ERROR on connect.");
    } catch (error) {
      expect(error).toBe(TEST_ERROR);
    }

    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;
  });

  it("testNoErrorOnConnectWithCallback", async () => {
    ErrorSimulatorManager.setCallback(instance(mockConnectCallback));
    when(mockConnectCallback.getErrorToRaise(anything(), anything(), anything())).thenReturn(null);

    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;
  });

  it("testRaiseErrorOnConnectWithCallback", async () => {
    ErrorSimulatorManager.setCallback(instance(mockConnectCallback));
    when(mockConnectCallback.getErrorToRaise(anything(), anything(), anything()))
      .thenThrow(TEST_ERROR)
      .thenReturn(null);

    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc);
      throw new Error("Dev plugin should throw TEST_ERROR on connect.");
    } catch (error) {
      expect(error).toBe(TEST_ERROR);
    }

    await expect(plugin.connect(hostInfo, properties, false, mockConnectFunc)).toHaveReturned;
  });
});
