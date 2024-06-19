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

import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";
import { mock } from "ts-mockito";
import { ConnectionPluginChainBuilder } from "aws-wrapper-common-lib/lib/connection_plugin_chain_builder";
import { PluginService } from "aws-wrapper-common-lib/lib/plugin_service";
import { ConnectionProvider } from "aws-wrapper-common-lib/lib/connection_provider";
import { DriverConnectionProvider } from "aws-wrapper-common-lib/lib/driver_connection_provider";
import { FailoverPlugin } from "aws-wrapper-common-lib/lib/plugins/failover/failover_plugin";
import { IamAuthenticationPlugin } from "aws-wrapper-common-lib/lib/authentication/iam_authentication_plugin";
import { DefaultPlugin } from "aws-wrapper-common-lib/lib/plugins/default_plugin";
import { ExecuteTimePlugin } from "aws-wrapper-common-lib/lib/plugins/execute_time_plugin";
import { ConnectTimePlugin } from "aws-wrapper-common-lib/lib/plugins/connect_time_plugin";
import { StaleDnsPlugin } from "aws-wrapper-common-lib/lib/plugins/stale_dns/stale_dns_plugin";

const mockPluginService: PluginService = mock(PluginService);
const mockDefaultConnProvider: ConnectionProvider = mock(DriverConnectionProvider);
const mockEffectiveConnProvider: ConnectionProvider = mock(DriverConnectionProvider);

describe("testConnectionPluginChainBuilder", () => {
  it.each([["iam,staleDns,failover"], ["iam,  staleDns,    failover"]])("sort plugins", async (plugins) => {
    const builder: ConnectionPluginChainBuilder = new ConnectionPluginChainBuilder();
    const props = new Map();
    props.set(WrapperProperties.PLUGINS.name, plugins);

    const result = builder.getPlugins(mockPluginService, props, mockDefaultConnProvider, mockEffectiveConnProvider);

    expect(result.length).toBe(4);
    expect(result[0]).toBeInstanceOf(StaleDnsPlugin);
    expect(result[1]).toBeInstanceOf(FailoverPlugin);
    expect(result[2]).toBeInstanceOf(IamAuthenticationPlugin);
    expect(result[3]).toBeInstanceOf(DefaultPlugin);
  });

  it("preserve plugin order", async () => {
    const builder: ConnectionPluginChainBuilder = new ConnectionPluginChainBuilder();
    const props = new Map();
    props.set(WrapperProperties.PLUGINS.name, "iam,staleDns,failover");
    props.set(WrapperProperties.AUTO_SORT_PLUGIN_ORDER.name, false);

    const result = builder.getPlugins(mockPluginService, props, mockDefaultConnProvider, mockEffectiveConnProvider);

    expect(result.length).toBe(4);
    expect(result[0]).toBeInstanceOf(IamAuthenticationPlugin);
    expect(result[1]).toBeInstanceOf(StaleDnsPlugin);
    expect(result[2]).toBeInstanceOf(FailoverPlugin);
    expect(result[3]).toBeInstanceOf(DefaultPlugin);
  });

  it("sort plugins with stick to prior", async () => {
    const builder: ConnectionPluginChainBuilder = new ConnectionPluginChainBuilder();
    const props = new Map();
    props.set(WrapperProperties.PLUGINS.name, "iam,executeTime,connectTime,failover");

    const result = builder.getPlugins(mockPluginService, props, mockDefaultConnProvider, mockEffectiveConnProvider);

    expect(result.length).toBe(5);
    expect(result[0]).toBeInstanceOf(FailoverPlugin);
    expect(result[1]).toBeInstanceOf(IamAuthenticationPlugin);
    expect(result[2]).toBeInstanceOf(ExecuteTimePlugin);
    expect(result[3]).toBeInstanceOf(ConnectTimePlugin);
    expect(result[4]).toBeInstanceOf(DefaultPlugin);
  });
});