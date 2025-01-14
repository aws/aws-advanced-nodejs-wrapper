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

import { anything, capture, instance, mock, spy, verify, when } from "ts-mockito";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { RDSClient } from "@aws-sdk/client-rds";
import { PluginService } from "../../common/lib/plugin_service";
import { CustomEndpointMonitorImpl } from "../../common/lib/plugins/custom_endpoint/custom_endpoint_monitor_impl";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { sleep } from "../../common/lib/utils/utils";
import { CustomEndpointInfo } from "../../common/lib/plugins/custom_endpoint/custom_endpoint_info";
import { CustomEndpointRoleType } from "../../common/lib/plugins/custom_endpoint/custom_endpoint_role_type";
import { MemberListType } from "../../common/lib/plugins/custom_endpoint/member_list_type";

const customEndpointUrl1 = "custom1.cluster-custom-XYZ.us-east-1.rds.amazonaws.com";
const customEndpointUrl2 = "custom2.cluster-custom-XYZ.us-east-1.rds.amazonaws.com";
const endpointId = "custom1";
const clusterId = "cluster1";
const staticMembersSet = new Set<string>(["member1", "member2"]);

const rdsSendResult1 = {
  $metadata: {
    httpStatusCode: 200,
    requestId: "",
    extendedRequestId: undefined,
    cfId: undefined,
    attempts: 1,
    totalRetryDelay: 0
  },
  DBClusterEndpoints: [
    {
      DBClusterEndpointIdentifier: endpointId,
      DBClusterIdentifier: clusterId,
      Endpoint: customEndpointUrl1,
      EndpointType: "CUSTOM",
      CustomEndpointType: "ANY",
      StaticMembers: staticMembersSet,
      ExcludedMembers: [],
      DBClusterEndpointArn: "",
      DBClusterEndpointResourceIdentifier: "",
      Status: "available"
    }
  ]
};
const rdsSendResult2 = {
  $metadata: {
    httpStatusCode: 200,
    requestId: "",
    extendedRequestId: undefined,
    cfId: undefined,
    attempts: 1,
    totalRetryDelay: 0
  },
  DBClusterEndpoints: [
    {
      DBClusterEndpointIdentifier: endpointId,
      DBClusterIdentifier: clusterId,
      Endpoint: customEndpointUrl1,
      EndpointType: "CUSTOM",
      CustomEndpointType: "ANY",
      StaticMembers: staticMembersSet,
      ExcludedMembers: [],
      DBClusterEndpointArn: "",
      DBClusterEndpointResourceIdentifier: "",
      Status: "available"
    },
    {
      DBClusterEndpointIdentifier: endpointId,
      DBClusterIdentifier: clusterId,
      Endpoint: customEndpointUrl2,
      EndpointType: "CUSTOM",
      CustomEndpointType: "ANY",
      StaticMembers: staticMembersSet,
      ExcludedMembers: [],
      DBClusterEndpointArn: "",
      DBClusterEndpointResourceIdentifier: "",
      Status: "available"
    }
  ]
};

const mockRdsClient = mock(RDSClient);
when(mockRdsClient.send(anything())).thenResolve(rdsSendResult2).thenResolve(rdsSendResult1);
const mockRdsClientFunc = () => instance(mockRdsClient);
const mockPluginService = mock(PluginService);
when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());

const props = new Map();
const host = new HostInfoBuilder({
  host: "custom.cluster-custom-XYZ.us-east-1.rds.amazonaws.com",
  port: 1234,
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
}).build();

const expectedInfo = new CustomEndpointInfo(
  endpointId,
  clusterId,
  customEndpointUrl1,
  CustomEndpointRoleType.ANY,
  staticMembersSet,
  MemberListType.STATIC_LIST
);

class TestCustomEndpointMonitorImpl extends CustomEndpointMonitorImpl {
  static getCache() {
    return TestCustomEndpointMonitorImpl.customEndpointInfoCache;
  }

  getStop() {
    return this.stop;
  }
}

describe("testCustomEndpoint", () => {
  beforeEach(() => {
    props.clear();
  });

  it("testRun", async () => {
    const monitor = new TestCustomEndpointMonitorImpl(instance(mockPluginService), host, endpointId, "us-east-1", 50, mockRdsClientFunc);

    // Wait for 2 run cycles. The first will return an unexpected number of endpoints in the API response, the second
    // will return the expected number of endpoints (one).
    await sleep(100);
    expect(TestCustomEndpointMonitorImpl.getCache().get(host.host)).toStrictEqual(expectedInfo);
    await monitor.close();

    const captureResult = capture(mockPluginService.setAllowedAndBlockedHosts).last();
    expect(captureResult[0].getAllowedHostIds()).toStrictEqual(staticMembersSet);
    expect(captureResult[0].getBlockedHostIds()).toBeNull();

    expect(monitor.getStop()).toBe(true);
    verify(mockRdsClient.destroy()).once();
  }, 100000);
});
