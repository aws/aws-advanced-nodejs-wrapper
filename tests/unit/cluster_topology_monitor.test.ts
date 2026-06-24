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

import { anything, instance, mock, when, verify } from "ts-mockito";
import { HostInfo } from "../../common/lib/host_info";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { HostRole } from "../../common/lib/host_role";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { PluginService, PluginServiceImpl } from "../../common/lib/plugin_service";
import { ClusterTopologyMonitorImpl } from "../../common/lib/host_list_provider/monitoring/cluster_topology_monitor";
import { MonitoringConnectionHandler } from "../../common/lib/host_list_provider/monitoring/monitoring_connection_handler";
import { FullServicesContainer } from "../../common/lib/utils/full_services_container";
import { TopologyUtils } from "../../common/lib/host_list_provider/topology_utils";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { StorageService } from "../../common/lib/utils/storage/storage_service";
import { DriverDialect } from "../../common/lib/driver_dialect/driver_dialect";
import { EventPublisher } from "../../common/lib/utils/events/event";
import { ClientWrapper } from "../../common/lib/client_wrapper";

const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const writerHost = builder.withHost("writer.cluster-abc.us-east-1.rds.amazonaws.com").withRole(HostRole.WRITER).build();
const readerHost1 = builder.withHost("reader1.cluster-abc.us-east-1.rds.amazonaws.com").withRole(HostRole.READER).build();
const readerHost2 = builder.withHost("reader2.cluster-abc.us-east-1.rds.amazonaws.com").withRole(HostRole.READER).build();
const allHosts = [writerHost, readerHost1, readerHost2];

class TestableClusterTopologyMonitor extends ClusterTopologyMonitorImpl {
  getConnectionHandlerForTest(): MonitoringConnectionHandler {
    return this.getConnectionHandler();
  }

  getMonitoringClientForTest(): ClientWrapper | null {
    return this.monitoringClient;
  }

  setMonitoringClientForTest(client: ClientWrapper | null): void {
    this.monitoringClient = client;
  }

  getWriterHostInfoForTest(): HostInfo | null {
    return this.writerHostInfo;
  }

  setConnectionHandlerForTest(handler: MonitoringConnectionHandler): void {
    this.connectionHandler = handler;
  }

  async callOpenAnyClientAndUpdateTopology(): Promise<HostInfo[] | null> {
    return this.openAnyClientAndUpdateTopology();
  }
}

describe("ClusterTopologyMonitorImpl - connection handler integration", () => {
  let mockPluginService: PluginService;
  let mockTopologyUtils: TopologyUtils;
  let mockStorageService: StorageService;
  let mockHostListProviderService: HostListProviderService;
  let mockDriverDialect: DriverDialect;
  let mockEventPublisher: EventPublisher;
  let servicesContainer: FullServicesContainer;
  let props: Map<string, any>;
  let monitor: TestableClusterTopologyMonitor;

  beforeEach(() => {
    mockPluginService = mock(PluginServiceImpl);
    mockTopologyUtils = mock<TopologyUtils>();
    mockStorageService = mock<StorageService>();
    mockHostListProviderService = mock<HostListProviderService>();
    mockDriverDialect = mock<DriverDialect>();
    mockEventPublisher = mock<EventPublisher>();

    when(mockPluginService.getDriverDialect()).thenReturn(instance(mockDriverDialect));
    when(mockDriverDialect.setConnectTimeout(anything(), anything())).thenReturn();
    when(mockDriverDialect.setQueryTimeout(anything(), anything(), anything())).thenReturn();

    servicesContainer = {
      pluginService: instance(mockPluginService),
      storageService: instance(mockStorageService),
      hostListProviderService: instance(mockHostListProviderService),
      eventPublisher: instance(mockEventPublisher),
      importantEventService: { registerEvent: () => {} }
    } as unknown as FullServicesContainer;

    props = new Map<string, any>();

    monitor = new TestableClusterTopologyMonitor(
      servicesContainer,
      instance(mockTopologyUtils),
      "cluster-id",
      writerHost,
      props,
      writerHost,
      30_000_000_000,
      5_000_000_000
    );
  });

  describe("getConnectionHandler (lazy)", () => {
    it("creates handler on first access", () => {
      const handler = monitor.getConnectionHandlerForTest();
      expect(handler).toBeDefined();
      expect(handler.acceptConnection).toBeDefined();
      expect(handler.acceptConnections).toBeDefined();
      expect(handler.attemptConnectionUpgrade).toBeDefined();
      expect(handler.close).toBeDefined();
    });

    it("returns same handler on subsequent access", () => {
      const handler1 = monitor.getConnectionHandlerForTest();
      const handler2 = monitor.getConnectionHandlerForTest();
      expect(handler1).toBe(handler2);
    });
  });

  describe("openAnyClientAndUpdateTopology", () => {
    it("connects and offers to handler via acceptConnection", async () => {
      const mockClient = {} as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(mockClient);
      when(mockTopologyUtils.isWriterInstance(anything())).thenResolve(true);
      when(mockTopologyUtils.queryForTopology(anything(), anything(), anything(), anything())).thenResolve(allHosts);

      await monitor.callOpenAnyClientAndUpdateTopology();

      // Handler accepted it (default AuroraMonitoringConnectionHandler accepts when monitoringClient is null)
      expect(monitor.getMonitoringClientForTest()).toBe(mockClient);
    });

    it("connects as reader — handler still accepts", async () => {
      const mockClient = {} as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(mockClient);
      when(mockTopologyUtils.isWriterInstance(anything())).thenResolve(false);
      when(mockTopologyUtils.queryForTopology(anything(), anything(), anything(), anything())).thenResolve(allHosts);

      await monitor.callOpenAnyClientAndUpdateTopology();

      expect(monitor.getMonitoringClientForTest()).toBe(mockClient);
    });

    it("returns null when forceConnect fails", async () => {
      when(mockPluginService.forceConnect(anything(), anything())).thenReject(new Error("conn refused"));

      const result = await monitor.callOpenAnyClientAndUpdateTopology();

      expect(result).toBeNull();
      expect(monitor.getMonitoringClientForTest()).toBeNull();
    });

    it("closes connection when handler rejects", async () => {
      let abortCallCount = 0;
      const mockClient = {
        abort: async () => {
          abortCallCount++;
        }
      } as unknown as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(mockClient);
      when(mockTopologyUtils.isWriterInstance(anything())).thenResolve(false);
      when(mockTopologyUtils.queryForTopology(anything(), anything(), anything(), anything())).thenResolve(allHosts);

      // Set a handler that always rejects.
      const mockHandler = mock<MonitoringConnectionHandler>();
      when(mockHandler.acceptConnection(anything(), anything(), anything())).thenReturn(false);
      monitor.setConnectionHandlerForTest(instance(mockHandler));

      await monitor.callOpenAnyClientAndUpdateTopology();

      expect(abortCallCount).toBe(1);
    });
  });

  describe("attemptConnectionUpgrade", () => {
    it("delegates to handler.attemptConnectionUpgrade", async () => {
      const mockClient = {} as ClientWrapper;
      monitor.setMonitoringClientForTest(mockClient);

      const mockHandler = mock<MonitoringConnectionHandler>();
      when(mockHandler.attemptConnectionUpgrade(anything())).thenResolve();
      monitor.setConnectionHandlerForTest(instance(mockHandler));

      await monitor.getConnectionHandlerForTest().attemptConnectionUpgrade(allHosts);

      verify(mockHandler.attemptConnectionUpgrade(anything())).once();
    });
  });
});
