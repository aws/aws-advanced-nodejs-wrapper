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

import { PluginService } from "aws-wrapper-common-lib/lib/plugin_service";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { HostInfo } from "aws-wrapper-common-lib/lib/host_info";
import { HostRole } from "aws-wrapper-common-lib/lib/host_role";
import { HostAvailability } from "aws-wrapper-common-lib/lib/host_availability/host_availability";
import { StaleDnsHelper } from "aws-wrapper-common-lib/lib/plugins/stale_dns/stale_dns_helper";
import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";
import { LookupAddress } from "dns";
import { HostChangeOptions } from "aws-wrapper-common-lib/lib/host_change_options";
import { DatabaseDialect } from "aws-wrapper-common-lib/lib/database_dialect/database_dialect";

const mockPluginService: PluginService = mock(PluginService);
const mockHostListProviderService = mock<HostListProviderService>();
const props: Map<string, any> = mock(Map<string, any>);

const writerInstance = new HostInfo("writer-host.XYZ.us-west-2.rds.amazonaws.com", 1234);
const writerCluster = new HostInfo("my-cluster.cluster-XYZ.us-west-2.rds.amazonaws.com", 1234);
const writerClusterInvalidClusterInetAddress = new HostInfo("my-cluster.cluster-invalid.us-west-2.rds.amazonaws.com", 1234);
const readerA = new HostInfo("reader-a-host.XYZ.us-west-2.rds.amazonaws.com", 1234, HostRole.READER, HostAvailability.AVAILABLE);
const readerB = new HostInfo("reader-b-host.XYZ.us-west-2.rds.amazonaws.com", 1234, HostRole.READER, HostAvailability.AVAILABLE);

const clusterHostList = [writerCluster, readerA, readerB];
const readerHostList = [readerA, readerB];
const instanceHostList = [writerInstance, readerA, readerB];

const mockInitialConn = mock(AwsClient);
const mockHostInfo = mock(HostInfo);
const mockDialect = mock<DatabaseDialect>();
const mockConnectFunc = jest.fn().mockImplementation(() => {
  return mockInitialConn;
});

describe("test_stale_dns_helper", () => {
  beforeEach(() => {
    when(mockPluginService.getCurrentClient()).thenReturn(mockInitialConn);
    when(mockPluginService.connect(anything(), anything())).thenResolve();
    when(mockPluginService.tryClosingTargetClient(anything())).thenResolve();
    when(mockPluginService.getDialect()).thenReturn(mockDialect);
    when(mockPluginService.getCurrentHostInfo()).thenReturn(mockHostInfo);
  });

  afterEach(() => {
    reset(mockInitialConn);
    reset(props);
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
    expect(returnConn).toBe(mockInitialConn);
  });

  it("test_get_verified_connection_cluster_inet_address_none", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);

    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    when(target.lookupResult(anything())).thenReturn();

    const returnConn = await targetInstance.getVerifiedConnection(
      writerClusterInvalidClusterInetAddress.host,
      true,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    expect(mockInitialConn).toBe(returnConn);
    expect(mockConnectFunc).toHaveBeenCalled();
  });

  it("test_get_verified_connection__no_writer_hostinfo", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);

    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);
    when(mockPluginService.getHosts()).thenReturn(readerHostList);

    when(mockPluginService.getCurrentHostInfo()).thenReturn(readerA);

    const lookupAddress = { address: "2.2.2.2", family: 0 };
    when(target.lookupResult(anything())).thenResolve(lookupAddress);

    const returnConn = await targetInstance.getVerifiedConnection(
      writerCluster.host,
      true,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    expect(mockConnectFunc).toHaveBeenCalled();
    expect(readerA.role).toBe(HostRole.READER);
    verify(mockPluginService.forceRefreshHostList(anything())).once();
    expect(mockInitialConn).toBe(returnConn);
  });

  it("test_get_verified_connection__writer_rds_cluster_dns_true", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);

    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    when(mockPluginService.getHosts()).thenReturn(clusterHostList);

    const lookupAddress = { address: "5.5.5.5", family: 0 };
    when(target.lookupResult(anything())).thenResolve(lookupAddress);

    const returnConn = await targetInstance.getVerifiedConnection(
      writerCluster.host,
      true,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    expect(mockConnectFunc).toHaveBeenCalled();
    verify(mockPluginService.refreshHostList(anything())).once();
    expect(mockInitialConn).toBe(returnConn);
  });

  it("test_get_verified_connection__writer_host_address_none", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);
    when(mockPluginService.getHosts()).thenReturn(instanceHostList);

    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    const firstCall = { address: "5.5.5.5", family: 0 };
    const secondCall = { address: "", family: 0 };

    when(target.lookupResult(anything())).thenResolve(firstCall, secondCall);

    const returnConn = await targetInstance.getVerifiedConnection(
      writerCluster.host,
      true,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    expect(mockConnectFunc).toHaveBeenCalled();
    expect(mockInitialConn).toBe(returnConn);
  });

  it("test_get_verified_connection__writer_host_info_none", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);
    when(mockPluginService.getHosts()).thenReturn(readerHostList);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    const firstCall = { address: "5.5.5.5", family: 0 };
    const secondCall = { address: "", family: 0 };

    when(target.lookupResult(anything())).thenResolve(firstCall, secondCall);

    const returnConn = await targetInstance.getVerifiedConnection(
      writerCluster.host,
      true,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    expect(mockConnectFunc).toHaveBeenCalled();
    expect(mockInitialConn).toBe(returnConn);
    verify(mockPluginService.connect(anything(), anything())).never();
  });

  it("test_get_verified_connection__writer_host_address_equals_cluster_inet_address", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);
    when(mockPluginService.getHosts()).thenReturn(instanceHostList);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);

    const firstCall = { address: "5.5.5.5", family: 0 };
    const secondCall = { address: "5.5.5.5", family: 0 };

    when(target.lookupResult(anything())).thenResolve(firstCall, secondCall);

    const returnConn = await targetInstance.getVerifiedConnection(
      writerCluster.host,
      true,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    expect(mockConnectFunc).toHaveBeenCalled();
    expect(mockInitialConn).toBe(returnConn);
    verify(mockPluginService.connect(anything(), anything())).never();
  });

  it("test_get_verified_connection__writer_host_address_not_equals_cluster_inet_address", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);

    when(mockPluginService.getHosts()).thenReturn(clusterHostList);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);
    targetInstance["writerHostInfo"] = writerCluster;

    const firstCall = { address: "5.5.5.5", family: 0 };
    const secondCall = { address: "8.8.8.8", family: 0 };

    when(target.lookupResult(anything())).thenResolve(firstCall, secondCall);

    const returnConn = await targetInstance.getVerifiedConnection(
      writerCluster.host,
      false,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    expect(mockInitialConn).not.toBe(returnConn);
    expect(mockConnectFunc).toHaveBeenCalled();
    verify(mockPluginService.connect(anything(), anything())).once();
  });

  it("test_get_verified_connection__initial_connection_writer_host_address_not_equals_cluster_inet_address", async () => {
    const target: StaleDnsHelper = spy(new StaleDnsHelper(instance(mockPluginService)));
    const targetInstance = instance(target);

    when(mockPluginService.getHosts()).thenReturn(clusterHostList);
    const mockHostListProviderServiceInstance = instance(mockHostListProviderService);
    targetInstance["writerHostInfo"] = writerCluster;
    when(mockHostListProviderService.getInitialConnectionHostInfo()).thenReturn(writerCluster);

    const firstCall = { address: "5.5.5.5", family: 0 };
    const secondCall = { address: "8.8.8.8", family: 0 };

    when(target.lookupResult(anything())).thenResolve(firstCall, secondCall);

    const returnConn = await targetInstance.getVerifiedConnection(
      writerCluster.host,
      true,
      mockHostListProviderServiceInstance,
      props,
      mockConnectFunc
    );

    verify(mockPluginService.connect(anything(), anything())).once();
    expect(targetInstance["writerHostInfo"]).toBe(mockHostListProviderServiceInstance.getInitialConnectionHostInfo());
    expect(mockInitialConn).not.toBe(returnConn);
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