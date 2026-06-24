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
import { GdbMonitoringConnectionHandler } from "../../common/lib/host_list_provider/monitoring/gdb_monitoring_connection_handler";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { instance, mock, when, anything } from "ts-mockito";

const builder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });

function hostInRegion(host: string, role: HostRole): HostInfo {
  return builder.withHost(host).withRole(role).build();
}

const writerPrimary = hostInRegion("writer-instance.cluster-abc.us-east-1.rds.amazonaws.com", HostRole.WRITER);
const readerPrimary = hostInRegion("reader-instance.cluster-abc.us-east-1.rds.amazonaws.com", HostRole.READER);
const writerSecondary = hostInRegion("writer-instance.cluster-xyz.us-west-2.rds.amazonaws.com", HostRole.WRITER);
const readerSecondary = hostInRegion("reader-instance.cluster-xyz.us-west-2.rds.amazonaws.com", HostRole.READER);
const readerEuWest = hostInRegion("reader-instance.cluster-xyz.eu-west-1.rds.amazonaws.com", HostRole.READER);

const allCandidates = [writerPrimary, readerPrimary, writerSecondary, readerSecondary, readerEuWest];

describe("GdbMonitoringConnectionHandler", () => {
  let mockPluginService: PluginService;
  let props: Map<string, any>;
  let monitoringClient: ClientWrapper | null;

  beforeEach(() => {
    mockPluginService = mock<PluginService>();
    props = new Map<string, any>();
    monitoringClient = null;
  });

  function createHandler(
    priority: string | null,
    accessibleRegions: string[] | null,
    homeRegion: string | null
  ): GdbMonitoringConnectionHandler {
    if (priority) {
      props.set(WrapperProperties.GDB_MONITORING_CONNECTION_PRIORITY.name, priority);
    }
    return new GdbMonitoringConnectionHandler(
      instance(mockPluginService),
      props,
      accessibleRegions,
      homeRegion,
      () => monitoringClient,
      (client) => {
        monitoringClient = client;
      }
    );
  }

  describe("acceptConnection", () => {
    it("accepts when monitoringClient is null", () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      const mockClient = {} as ClientWrapper;
      const result = handler.acceptConnection(mockClient, true, writerPrimary);
      expect(result).toBe(true);
      expect(monitoringClient).toBe(mockClient);
    });

    it("rejects when offered connection is not higher priority", () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      const firstClient = {} as ClientWrapper;
      handler.acceptConnection(firstClient, true, writerPrimary);

      const readerClient = {} as ClientWrapper;
      const result = handler.acceptConnection(readerClient, false, readerPrimary);
      expect(result).toBe(false);
      expect(monitoringClient).toBe(firstClient);
    });
  });

  describe("attemptConnectionUpgrade", () => {
    it("does not upgrade when already at best priority", async () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      const writerClient = {} as ClientWrapper;
      handler.acceptConnection(writerClient, true, writerPrimary);

      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(writerClient);
    });

    it("upgrades from reader to writer in primary region", async () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerPrimary);

      const writerClient = { abort: async () => {} } as unknown as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(writerClient);

      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(writerClient);
    });

    it("does not upgrade when monitoringClient is null", async () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBeNull();
    });

    it("keeps current connection when forceConnect fails", async () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerPrimary);

      when(mockPluginService.forceConnect(anything(), anything())).thenReject(new Error("conn refused"));
      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(readerClient);
    });

    it("does not upgrade when already at best priority", async () => {
      const handler = createHandler("strict-reader-primary", null, "us-east-1");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerPrimary);

      // First upgrade sets primaryRegion and recognizes we're at priority 0.
      await handler.attemptConnectionUpgrade(allCandidates);
      // Second call should short-circuit since currentPriorityIndex is now 0.
      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(readerClient);
    });
  });

  describe("acceptConnections", () => {
    it("selects preferred host from connections map", () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      const writerClient = {} as ClientWrapper;
      const readerClient = {} as ClientWrapper;
      const connections = new Map<HostInfo, ClientWrapper>([
        [readerPrimary, readerClient],
        [writerPrimary, writerClient]
      ]);

      const selected = handler.acceptConnections(connections, writerPrimary, allCandidates);
      expect(selected).toBe(writerPrimary);
      expect(monitoringClient).toBe(writerClient);
    });

    it("falls back to any connection when preferred not in map", () => {
      const handler = createHandler("strict-writer-primary", null, "us-east-1");
      const readerClient = {} as ClientWrapper;
      const connections = new Map<HostInfo, ClientWrapper>([[readerSecondary, readerClient]]);

      const selected = handler.acceptConnections(connections, null, [readerSecondary]);
      expect(selected).toBe(readerSecondary);
      expect(monitoringClient).toBe(readerClient);
    });
  });

  describe("accessible regions filtering", () => {
    it("filters out hosts not in accessible regions during upgrade", async () => {
      const handler = createHandler("strict-writer-primary", ["us-west-2"], "us-east-1");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerSecondary);

      const writerClient = { abort: async () => {} } as unknown as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(writerClient);

      await handler.attemptConnectionUpgrade(allCandidates);
      // Writer in us-west-2 (accessible) should be selected.
      expect(monitoringClient).toBe(writerClient);
    });

    it("does not upgrade when accessible regions filter removes all better candidates", async () => {
      const handler = createHandler("strict-writer-primary", ["ap-southeast-1"], "us-east-1");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerPrimary);

      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(readerClient);
    });
  });

  describe("region priority", () => {
    it("selects host in specified region", async () => {
      const handler = createHandler("eu-west-1", null, "us-east-1");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerPrimary);

      const euClient = { abort: async () => {} } as unknown as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(euClient);

      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(euClient);
    });
  });

  describe("multi-priority list", () => {
    it("falls through priorities: strict-writer-primary,strict-reader-secondary", async () => {
      const handler = createHandler("strict-writer-primary,strict-reader-secondary", null, "us-east-1");
      const readerClient = {} as ClientWrapper;
      handler.acceptConnection(readerClient, false, readerSecondary);

      // readerSecondary satisfies index 1 (strict-reader-secondary).
      // Should upgrade to writerPrimary (index 0).
      const writerClient = { abort: async () => {} } as unknown as ClientWrapper;
      when(mockPluginService.forceConnect(anything(), anything())).thenResolve(writerClient);

      await handler.attemptConnectionUpgrade(allCandidates);
      expect(monitoringClient).toBe(writerClient);
    });
  });
});
