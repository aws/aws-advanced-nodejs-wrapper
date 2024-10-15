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
import { ErrorSimulatorExecuteJdbcMethodCallback } from "../../common/lib/plugins/dev/error_simulator_execute_jdbc_method_callback";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { ErrorSimulatorManager } from "../../common/lib/plugins/dev/error_simulator_manager";
import { ErrorSimulatorConnectCallback, ErrorSimulatorConnectCallbackImpl } from "../../common/lib/plugins/dev/error_simulator_connect_callback";

const defaultPort = 1234;
const hostInfo = new HostInfo("pg.testdb.us-east-2.rds.amazonaws.com", defaultPort);

const mockPluginService = mock(PluginService);
const mockRdsUtils = mock(RdsUtils);
const mockConnectFunc = jest.fn().mockImplementation(() => {
  return;
});

const TEST_ERROR = new Error("test");

const properties: Map<string, any> = new Map();
let plugin: DeveloperConnectionPlugin;

const mockConnectCallback: ErrorSimulatorConnectCallback = instance(mock(ErrorSimulatorConnectCallbackImpl));

when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_INSTANCE);

function initializePlugin(nextMethodName?: string, nextError?: Error, ErrorSimulatorExecuteJdbcMethodCallback?: ErrorSimulatorExecuteJdbcMethodCallback) {
  plugin = new DeveloperConnectionPlugin(instance(mockPluginService), properties, instance(mockRdsUtils), nextMethodName, nextError, ErrorSimulatorExecuteJdbcMethodCallback);
}

describe("testDevPlugin", () => {

  it("testConnectionNoError", async () => {
    properties.set(WrapperProperties.PLUGINS.name, "dev");
    initializePlugin();

    var thrownErrors = 0;
    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc)
    } catch (error) {
      thrownErrors++;
    } 
    expect(thrownErrors).toBe(0);
  });

  it("testRaiseErrorOnConnect", async () => { //TODO: fix way we check how it throws 
    properties.set(WrapperProperties.PLUGINS.name, "dev");
    initializePlugin();

    ErrorSimulatorManager.raiseErrorOnNextConnect(TEST_ERROR);

    var thrownErrors = 0;
    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc);
    } catch (error) {
      expect(error).toBe(TEST_ERROR);
      thrownErrors++;
    } 
    expect(thrownErrors).toBe(1);

    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc);
    } catch (error) {
      thrownErrors++;
    } 
    expect(thrownErrors).toBe(1);
  });

  it("testNoErrorOnConnectWithCallback", async () => {
    properties.set(WrapperProperties.PLUGINS.name, "dev");
    initializePlugin();

    when(mockConnectCallback.getErrorToRaise(anything(), anything(), anything())).thenReturn(null);
    ErrorSimulatorManager.setCallback(mockConnectCallback);
    
    var thrownErrors = 0;
    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc);
    } catch (error) {
      console.log(error);
      thrownErrors++;
    } 
    expect(thrownErrors).toBe(0);
  });

  it("testRaiseErrorOnConnectWithCallback", async () => {
    properties.set(WrapperProperties.PLUGINS.name, "dev");
    initializePlugin();

    when(mockConnectCallback.getErrorToRaise(anything(), anything(), anything())).thenThrow(TEST_ERROR).thenReturn(null);

    ErrorSimulatorManager.setCallback(mockConnectCallback);
    expect(ErrorSimulatorManager.connectCallback).toBe(mockConnectCallback);

    var thrownErrors = 0;
    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc);
    } catch (error) {
      expect(error).toBe(TEST_ERROR);
      thrownErrors++;
    } 
    expect(thrownErrors).toBe(1);
    try {
      await plugin.connect(hostInfo, properties, false, mockConnectFunc);
    } catch (error) {
      thrownErrors++;
    } 
    expect(thrownErrors).toBe(1);
  });
});
