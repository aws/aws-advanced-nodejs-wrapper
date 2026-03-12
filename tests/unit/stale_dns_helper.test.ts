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

import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { HostInfo } from "../../common/lib";
import { HostRole } from "../../common/lib";
import { HostAvailability } from "../../common/lib";
import { StaleDnsHelper } from "../../common/lib/plugins/stale_dns/stale_dns_helper";
import { AwsClient } from "../../common/lib/aws_client";
import { HostChangeOptions } from "../../common/lib/host_change_options";
import { DatabaseDialect } from "../../common/lib/database_dialect/database_dialect";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { jest } from "@jest/globals";

const mockPluginService: PluginServiceImpl = mock(PluginServiceImpl);
const mockHostListProviderService = mock<HostListProviderService>();
const props: Map<string, any> = new Map();

const writerInstance = new HostInfo("writer-host.XYZ.us-west-2.rds.amazonaws.com", 1234, HostRole.WRITER);

const mockInitialConn = mock(AwsClient);
const mockHostInfo = mock(HostInfo);
const mockDialect = mock<DatabaseDialect>();
const mockInitialClientWrapper: ClientWrapper = mock(MySQLClientWrapper);

const mockConnectFunc = jest.fn(() => {
  return Promise.resolve(mockInitialClientWrapper);
});

describe("test_stale_dns_helper", () => {
  beforeEach(() => {
    when(mockPluginService.getCurrentClient()).thenReturn(mockInitialConn);
    when(mockPluginService.connect(anything(), anything())).thenResolve();
    when(mockPluginService.abortTargetClient(anything())).thenResolve();
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(mockHostInfo);
    when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());
  });

  afterEach(() => {
    reset(mockInitialConn);
    reset(mockHostListProviderService);
    reset(mockPluginService);
    reset(mockHostInfo);
  });

  it("test_get_verified_connection_is_writer_cluster_dns_false", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);

    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);
    const invalidHost = new HostInfo("invalid_host", 1234);

    const returnConn = await targetInstance.getVerifiedConnection(
      invalidHost.host,
      false,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );
    expect(mockConnectFunc).toHaveBeenCalled();
    expect(returnConn).toBe(mockInitialClientWrapper);
  });

  it("test_notify_host_list_changed", () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);
    targetInstance["writerHostInfo"] = writerInstance;

    const hostInfoUrl: string = targetInstance["writerHostInfo"].url;
    const change = new Set<HostChangeOptions>([HostChangeOptions.PROMOTED_TO_READER]);
    const changes: Map<string, Set<HostChangeOptions>> = new Map<string, Set<HostChangeOptions>>().set(hostInfoUrl, change);

    targetInstance.notifyHostListChanged(changes);

    expect(targetInstance["writerHostInfo"]).toBeNull();
    expect(targetInstance["writerHostAddress"]).toBe("");
  });
});
