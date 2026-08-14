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

import { HostInfo } from "../../common/lib/host_info";
import { HostRole } from "../../common/lib/host_role";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { PluginService } from "../../common/lib/plugin_service";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { AuroraMonitoringConnectionHandler } from "../../common/lib/host_list_provider/monitoring/aurora_monitoring_connection_handler";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { instance, mock, when, anything } from "ts-mockito";

const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });

const writerHost = builder.withHost("writer.cluster-abc.us-east-1.rds.amazonaws.com").withRole(HostRole.WRITER).build();
const readerHost1 = builder.withHost("reader1.cluster-abc.us-east-1.rds.amazonaws.com").withRole(HostRole.READER).build();
const readerHost2 = builder.withHost("reader2.cluster-abc.us-east-1.rds.amazonaws.com").withRole(HostRole.READER).build();

const allCandidates = [writerHost, readerHost1, readerHost2];

describe("AuroraMonitoringConnectionHandler", () => {
  let mockPluginService: PluginService;
  let props: Map<string, any>;
  let monitoringClient: ClientWrapper | null;

  beforeEach(() => {
    mockPluginService = mock<PluginService>();
    props = new Map<string, any>();
    monitoringClient = null;
  });

  function createHandler(priority: string | null): AuroraMonitoringConnectionHandler {
    if (priority) {
      props.set(WrapperProperties.MONITORING_CONNECTION_PRIORITY.name, priority);
    }
    return new AuroraMonitoringConnectionHandler(
      instance(mockPluginService),
      props,
      () => monitoringClient,
      (client) => {
        monitoringClient = client;
      }
    );
  }

  describe("acceptConnection", () => {
    it("accepts when monitoringClient is null", () => {
      const handler = createHandler(null);
      const mockClient = {} as ClientWrapper;
      const result = handler.acceptConnection(mockClient, true, writerHost);
      expect(result).toBe(true);
      expect(monitoringClient).toBe(mockClient);
    });

    it("rejects when offered connection is not higher priority", () => {
      const handler = createHandler(null);
      const firstClient = {} as ClientWrapper;
      handler.acceptConnection(firstClient, true, writerHost);

      const newClient = {} as ClientWrapper;
      const result = handler.acceptConnection(newClient, false, readerHost1);
      expect(result).toBe(false);
      expect(monitoringClient).toBe(firstClient);
    });

    it("replaces when offered connection is higher priority", () => {
      const handler = createHandler(null);
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerHost1);

      const writerClient = {} as ClientWrapper;
      const result = handler.acceptConnection(writerClient, true, writerHost);
      expect(result).toBe(true);
      expect(monitoringClient).toBe(writerClient);
    });
  });

  describe("attemptConnectionUpgrade", () => {
    it("does not upgrade when already at best priority (writer with strict-writer)", async () => {
      const handler = createHandler("strict-writer");
      const existingClient = {} as ClientWrapper;
      handler.acceptConnection(existingClient, true, writerHost);

      when(mockPluginService.forceConnect(anything(), anything())).thenResolve({} as any);
      await handler.attemptConnectionUpgrade(allCandidates);

      // Should still be the same client — no upgrade needed.
      expect(monitoringClient).toBe(existingClient);
    });

    it("upgrades from reader to writer with strict-writer priority", async () => {
      const handler = createHandler("strict-writer");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerHost1);

      const writerClient = { abort: async () => {} } as unknown as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(writerClient);

      await handler.attemptConnectionUpgrade(allCandidates);

      expect(monitoringClient).toBe(writerClient);
    });

    it("does not upgrade when reader with strict-reader priority", async () => {
      const handler = createHandler("strict-reader");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerHost1);

      await handler.attemptConnectionUpgrade(allCandidates);

      expect(monitoringClient).toBe(readerClient);
    });

    it("does not upgrade when monitoringClient is null", async () => {
      const handler = createHandler("strict-writer");
      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBeNull();
    });

    it("upgrades from writer to reader with strict-reader priority after acceptConnection records the index", async () => {
      // Regression coverage for the panic-mode writer-detected path: the monitor now offers the verified
      // writer connection through acceptConnection (rather than assigning monitoringClient directly), so the
      // handler records the writer's priority index. With a strict-reader priority, a subsequent upgrade must
      // then be able to move to a reader. If the index were not recorded, attemptConnectionUpgrade would
      // short-circuit and the configured priority would be silently ignored.
      const handler = createHandler("strict-reader");
      const writerClient = { abort: async () => {} } as unknown as ClientWrapper;
      handler.acceptConnection(writerClient, true, writerHost);

      const readerClient = {} as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(readerClient);

      await handler.attemptConnectionUpgrade(allCandidates);

      expect(monitoringClient).toBe(readerClient);
    });

    it("does not upgrade when no suitable candidate exists", async () => {
      const handler = createHandler("strict-writer");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerHost1);

      await handler.attemptConnectionUpgrade([readerHost1, readerHost2]);

      expect(monitoringClient).toBe(readerClient);
    });

    it("keeps current connection when forceConnect fails", async () => {
      const handler = createHandler("strict-writer");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerHost1);

      when(mockPluginService.forceConnect(anything(), anything())).thenReject(new Error("conn refused"));
      await handler.attemptConnectionUpgrade(allCandidates);

      expect(monitoringClient).toBe(readerClient);
    });
  });

  describe("acceptConnections", () => {
    it("selects preferred host from connections map", () => {
      const handler = createHandler("strict-writer");
      const writerClient = {} as ClientWrapper;
      const readerClient = {} as ClientWrapper;
      const connections = new Map<HostInfo, ClientWrapper>([
        [readerHost1, readerClient],
        [writerHost, writerClient]
      ]);

      const selected = handler.acceptConnections(connections, writerHost, allCandidates);
      expect(selected).toBe(writerHost);
      expect(monitoringClient).toBe(writerClient);
    });

    it("falls back to any connection when preferred not in map", () => {
      const handler = createHandler("strict-writer");
      const readerClient = {} as ClientWrapper;
      const connections = new Map<HostInfo, ClientWrapper>([[readerHost1, readerClient]]);

      const selected = handler.acceptConnections(connections, null, [readerHost1, readerHost2]);
      expect(selected).toBe(readerHost1);
      expect(monitoringClient).toBe(readerClient);
    });
  });

  describe("writer-or-reader priority", () => {
    it("does not upgrade when holding a reader with writer-or-reader priority", async () => {
      const handler = createHandler("writer-or-reader");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerHost1);

      // writer-or-reader is satisfied by any connection, so no upgrade needed.
      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(readerClient);
    });
  });
});
