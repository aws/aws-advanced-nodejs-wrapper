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

import { FailoverError } from "../../common/lib/utils/errors";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { HostRole } from "../../common/lib/host_role";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { PluginService } from "../../common/lib/plugin_service";
import { anything, instance, mock, reset, verify, when } from "ts-mockito";
import {
  AuroraConnectionTrackerPlugin
} from "../../common/lib/plugins/connection_tracker/aurora_connection_tracker_plugin";
import { OpenedConnectionTracker } from "../../common/lib/plugins/connection_tracker/opened_connection_tracker";
import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { RdsUrlType } from "../../common/lib/utils/rds_url_type";
import { AwsClient } from "../../common/lib/aws_client";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { HostInfo } from "../../common/lib/host_info";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { jest } from "@jest/globals";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";

const props = new Map<string, any>();
const SQL_ARGS = ["sql"];

const mockPluginService = mock(PluginService);
const mockSqlFunc = jest.fn(() => {
  return Promise.resolve("0");
});
const mockConnectFunc = jest.fn(() => {
  return Promise.resolve(mockClientWrapper);
});

const mockTracker = mock(OpenedConnectionTracker);
const mockRdsUtils = mock(RdsUtils);
const mockClient = mock(AwsClient);
const mockHostInfo = mock(HostInfo);

const mockClientInstance = instance(mockClient);
const mockClientWrapper: ClientWrapper = new MySQLClientWrapper(undefined, mockHostInfo, props, new MySQL2DriverDialect());

mockClientInstance.targetClient = mockClientWrapper;

describe("aurora connection tracker tests", () => {
  beforeEach(() => {
    when(mockRdsUtils.getRdsInstanceHostPattern(anything())).thenReturn("?");
    when(mockRdsUtils.identifyRdsType(anything())).thenReturn(RdsUrlType.RDS_INSTANCE);
    when(mockPluginService.getCurrentClient()).thenReturn(mockClientInstance);
  });

  afterEach(() => {
    jest.clearAllMocks();
    reset(mockTracker);
    reset(mockRdsUtils);
    reset(mockHostInfo);
  });

  it.each([[true], [false]])("test track new connections parameters", async (isInitialConnection: boolean) => {
    const hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("instance1").build();
    mockConnectFunc.mockResolvedValueOnce(mockClientWrapper);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(hostInfo);
    when(mockRdsUtils.isRdsInstance("instance1")).thenReturn(true);

    const plugin = new AuroraConnectionTrackerPlugin(instance(mockPluginService), instance(mockRdsUtils), instance(mockTracker));
    const client = await plugin.connect(hostInfo, props, isInitialConnection, mockConnectFunc);
    expect(client).toBe(mockClientWrapper);
    verify(mockTracker.populateOpenedConnectionQueue(hostInfo, mockClientWrapper)).called();
    const aliases = hostInfo.aliases;
    expect(aliases.size).toBe(0);
  });

  it("test invalidate opened connections when writer host not changed", async () => {
    const expectedError = new FailoverError();
    mockSqlFunc.mockRejectedValue(expectedError);

    const originalHost = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() })
      .withHost("host")
      .withRole(HostRole.WRITER)
      .build();
    new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("new-host").withRole(HostRole.WRITER).build();
    when(mockPluginService.getAllHosts()).thenReturn([originalHost]);

    const plugin = new AuroraConnectionTrackerPlugin(instance(mockPluginService), instance(mockRdsUtils), instance(mockTracker));

    await expect(plugin.execute("query", mockSqlFunc, SQL_ARGS)).rejects.toThrow(expectedError);
    verify(mockTracker.invalidateAllConnections(originalHost)).never();
  });

  it("test invalidate opened connections when writer host changed", async () => {
    const expectedError = new FailoverError("reason", "sqlstate");
    const originalHost = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host").build();
    const failoverTargetHost = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost("host2").build();

    when(mockPluginService.getAllHosts()).thenReturn([originalHost]).thenReturn([failoverTargetHost]);
    mockSqlFunc.mockResolvedValueOnce("1").mockRejectedValueOnce(expectedError);

    const plugin = new AuroraConnectionTrackerPlugin(instance(mockPluginService), instance(mockRdsUtils), instance(mockTracker));

    await plugin.execute("query", mockSqlFunc, SQL_ARGS);
    await expect(plugin.execute("query", mockSqlFunc, SQL_ARGS)).rejects.toThrow(expectedError);
    verify(mockTracker.invalidateAllConnections(originalHost)).once();
  });
});
