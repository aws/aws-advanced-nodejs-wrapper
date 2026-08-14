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

import { HostInfo } from "../../host_info";
import { HostRole } from "../../host_role";
import { PluginService } from "../../plugin_service";
import { ClientWrapper } from "../../client_wrapper";

export enum MonitoringConnectionPriority {
  STRICT_WRITER = "strict-writer",
  STRICT_READER = "strict-reader",
  WRITER_OR_READER = "writer-or-reader"
}

export function monitoringConnectionPriorityFromValue(value: string | null): MonitoringConnectionPriority {
  if (!value) {
    return MonitoringConnectionPriority.STRICT_WRITER;
  }
  const lower = value.toLowerCase();
  switch (lower) {
    case "strict-writer":
      return MonitoringConnectionPriority.STRICT_WRITER;
    case "strict-reader":
      return MonitoringConnectionPriority.STRICT_READER;
    case "writer-or-reader":
      return MonitoringConnectionPriority.WRITER_OR_READER;
    default:
      return MonitoringConnectionPriority.STRICT_WRITER;
  }
}

export function parseMonitoringConnectionPriorities(value: string | null): MonitoringConnectionPriority[] {
  if (!value) {
    return [MonitoringConnectionPriority.STRICT_WRITER];
  }
  const results: MonitoringConnectionPriority[] = [];
  for (const part of value.split(",")) {
    results.push(monitoringConnectionPriorityFromValue(part.trim()));
  }
  return results.length > 0 ? results : [MonitoringConnectionPriority.STRICT_WRITER];
}

/**
 * Handles monitoring connection lifecycle: accepting connections offered by the monitor,
 * and upgrading to a higher-priority connection when possible.
 */
export interface MonitoringConnectionHandler {
  /**
   * Called when a connection is offered to the handler (e.g., from openAnyClientAndUpdateTopology).
   * The handler decides whether to accept it as the monitoring connection or reject it.
   *
   * @param client the offered client connection
   * @param isWriter true if the connection is to a writer instance
   * @param hostInfo the host info of the connection
   * @returns true if the connection was accepted (handler sets it as monitoring connection),
   *          false if rejected (caller should close it)
   */
  acceptConnection(client: ClientWrapper, isWriter: boolean, hostInfo: HostInfo): boolean;

  /**
   * Offers a batch of harvested connections (from host monitor threads after panic mode resolves)
   * to the handler. The handler picks the best one according to its priority and sets it as the
   * monitoring connection. Returns the host of the selected connection so the caller can clean up
   * the rest.
   *
   * @param connections map of host -> client harvested from node threads
   * @param writerHostInfo the writer host (if known)
   * @param topology the current topology
   * @returns the host info of the selected connection, or null if none selected
   */
  acceptConnections(connections: Map<HostInfo, ClientWrapper>, writerHostInfo: HostInfo | null, topology: HostInfo[]): HostInfo | null;

  /**
   * Non-blocking attempt to upgrade the monitoring connection to a higher-priority node.
   * If the current connection already satisfies the highest priority, this is a no-op.
   *
   * @param currentTopology the current filtered cluster topology
   */
  attemptConnectionUpgrade(currentTopology: HostInfo[]): Promise<void>;

  /**
   * Cleans up resources held by the handler.
   */
  close(): Promise<void>;
}

/**
 * Base class for monitoring connection handlers that manage a priority-ordered connection
 * lifecycle. Subclasses provide priority-specific logic via abstract hooks.
 *
 * @typeParam P the priority type (e.g. MonitoringConnectionPriority, GdbPriorityConfig)
 */
export abstract class AbstractMonitoringConnectionHandler<P> implements MonitoringConnectionHandler {
  protected readonly pluginService: PluginService;
  protected readonly monitoringProperties: Map<string, any>;
  protected readonly priorities: P[];
  protected readonly getMonitoringClient: () => ClientWrapper | null;
  protected readonly setMonitoringClient: (client: ClientWrapper | null) => void;
  protected currentPriorityIndex: number = -1;

  protected constructor(
    pluginService: PluginService,
    monitoringProperties: Map<string, any>,
    priorities: P[],
    getMonitoringClient: () => ClientWrapper | null,
    setMonitoringClient: (client: ClientWrapper | null) => void
  ) {
    this.pluginService = pluginService;
    this.monitoringProperties = monitoringProperties;
    this.priorities = priorities;
    this.getMonitoringClient = getMonitoringClient;
    this.setMonitoringClient = setMonitoringClient;
  }

  protected abstract getPriorityIndex(hostInfo: HostInfo, isWriter: boolean): number;
  protected abstract findHostsForPriority(priorityIndex: number, candidates: HostInfo[]): HostInfo[];

  protected effectiveIndex(priorityIndex: number): number {
    return priorityIndex >= 0 ? priorityIndex : this.priorities.length;
  }

  acceptConnection(client: ClientWrapper, isWriter: boolean, hostInfo: HostInfo): boolean {
    const priorityIndex = this.getPriorityIndex(hostInfo, isWriter);
    const effectiveIndex = this.effectiveIndex(priorityIndex);

    if (this.getMonitoringClient() === null || this.currentPriorityIndex < 0) {
      this.setMonitoringClient(client);
      this.currentPriorityIndex = effectiveIndex;
      return true;
    }

    if (effectiveIndex < this.currentPriorityIndex) {
      this.setMonitoringClient(client);
      this.currentPriorityIndex = effectiveIndex;
      return true;
    }

    return false;
  }

  acceptConnections(connections: Map<HostInfo, ClientWrapper>, writerHostInfo: HostInfo | null, topology: HostInfo[]): HostInfo | null {
    if (!connections || connections.size === 0) {
      return null;
    }

    let bestHost: HostInfo | null = null;
    let bestIndex = this.priorities.length;

    for (const [hostInfo, client] of connections) {
      if (!client) {
        continue;
      }
      const isWriter = writerHostInfo !== null && writerHostInfo.host === hostInfo.host;
      const effectiveIndex = this.effectiveIndex(this.getPriorityIndex(hostInfo, isWriter));
      if (bestHost === null || effectiveIndex < bestIndex) {
        bestIndex = effectiveIndex;
        bestHost = hostInfo;
      }
    }

    if (!bestHost) {
      return null;
    }

    const bestClient = connections.get(bestHost);
    this.setMonitoringClient(bestClient);
    this.currentPriorityIndex = bestIndex;
    return bestHost;
  }

  async attemptConnectionUpgrade(currentTopology: HostInfo[]): Promise<void> {
    if (this.currentPriorityIndex <= 0) {
      return;
    }

    const candidates = this.findUpgradeCandidates(currentTopology);
    if (candidates.length === 0) {
      return;
    }

    for (const candidate of candidates) {
      try {
        const newClient = await this.pluginService.forceConnect(candidate, this.monitoringProperties);
        const oldClient = this.getMonitoringClient();
        this.setMonitoringClient(newClient);
        const isWriter = candidate.role === HostRole.WRITER;
        this.currentPriorityIndex = this.effectiveIndex(this.getPriorityIndex(candidate, isWriter));
        await oldClient?.abort();
        return;
      } catch {
        // Try next candidate.
      }
    }
  }

  private findUpgradeCandidates(hosts: HostInfo[]): HostInfo[] {
    const candidates: HostInfo[] = [];
    const limit = Math.min(this.currentPriorityIndex, this.priorities.length);
    for (let i = 0; i < limit; i++) {
      const matching = this.findHostsForPriority(i, hosts);
      candidates.push(...matching);
    }
    return candidates;
  }

  async close(): Promise<void> {
    this.currentPriorityIndex = -1;
  }
}
