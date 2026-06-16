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

import { RdsUtils } from "../../utils/rds_utils";
import { ClientWrapper } from "../../client_wrapper";
import { HostInfo } from "../../host_info";
import { logger } from "../../../logutils";
import { MapUtils } from "../../utils/map_utils";
import { Messages } from "../../utils/messages";
import { PluginService } from "../../plugin_service";
import { TrackedConnectionList, TrackedConnectionListHost } from "./tracked_connection_list";

export class OpenedConnectionTracker {
  static readonly openedConnections: Map<string, TrackedConnectionList> = new Map<string, TrackedConnectionList>();
  readonly pluginService: PluginService;
  private static readonly rdsUtils = new RdsUtils();

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
  }

  populateOpenedConnectionQueue(hostInfo: HostInfo, client: ClientWrapper): TrackedConnectionListHost | null {
    if (!hostInfo || !client) {
      return null;
    }

    // Check if the connection was established using an instance endpoint.
    if (OpenedConnectionTracker.rdsUtils.isRdsInstance(hostInfo.host)) {
      const host = this.trackConnection(hostInfo.hostAndPort, client);
      this.logOpenedConnections();
      return host;
    }

    // It might be a custom domain name. Let's track by hostId and custom domain name.
    let lastHost: TrackedConnectionListHost | null = null;
    if (hostInfo.hostId) {
      lastHost = this.trackConnection(hostInfo.hostId, client);
    }
    if (hostInfo.hostAndPort) {
      lastHost = this.trackConnection(hostInfo.hostAndPort, client);
    }
    this.logOpenedConnections();
    return lastHost;
  }

  async invalidateAllConnections(hostInfo: HostInfo): Promise<void> {
    if (!hostInfo) {
      return;
    }
    await this.invalidateAllConnectionsMultipleHosts(hostInfo.hostAndPort, hostInfo.host, hostInfo.hostId);
  }

  async invalidateAllConnectionsMultipleHosts(...keys: string[]): Promise<void> {
    for (const key of keys) {
      if (!key) {
        continue;
      }
      try {
        const connectionList = OpenedConnectionTracker.openedConnections.get(key);
        this.logConnectionList(key, connectionList);
        await this.invalidateConnections(connectionList);
      } catch (error) {
        // Ignore and continue with the remaining keys.
      }
    }
  }

  removeConnectionTracking(host: TrackedConnectionListHost | null): void {
    host?.remove();
  }

  removeConnectionTrackingByHost(hostInfo: HostInfo, client: ClientWrapper | undefined | null): void {
    const hostAndPort = OpenedConnectionTracker.rdsUtils.isRdsInstance(hostInfo.host) ? hostInfo.hostAndPort : null;
    if (!hostAndPort) {
      return;
    }

    const connectionList = OpenedConnectionTracker.openedConnections.get(hostAndPort);
    if (connectionList) {
      connectionList.removeIf((ref) => {
        const conn = ref.deref();
        return !conn || conn === client;
      });
    }
  }

  private trackConnection(instanceEndpoint: string, client: ClientWrapper): TrackedConnectionListHost {
    const connectionList = MapUtils.computeIfAbsent(
      OpenedConnectionTracker.openedConnections,
      instanceEndpoint,
      (_) => new TrackedConnectionList()
    );
    return connectionList!.add(client);
  }

  private async invalidateConnections(connectionList: TrackedConnectionList | undefined): Promise<void> {
    if (!connectionList || connectionList.isEmpty()) {
      return;
    }

    const connections = connectionList.drainAll();
    for (const client of connections) {
      await this.pluginService.abortTargetClient(client);
    }
  }

  logOpenedConnections(): void {
    const hostList: string[] = [];
    for (const connectionList of OpenedConnectionTracker.openedConnections.values()) {
      for (const conn of connectionList.getConnections()) {
        hostList.push(`${conn.id} - ${conn.hostInfo.toString()}`);
      }
    }
    logger.debug(`Opened Connections Tracked: \n\t${hostList.join("\n\t")}`);
  }

  private logConnectionList(host: string, connectionList: TrackedConnectionList | undefined): void {
    if (!connectionList || connectionList.isEmpty()) {
      return;
    }

    const connections = connectionList.getConnections().map((conn) => conn.hostInfo);
    logger.debug(Messages.get("OpenedConnectionTracker.invalidatingConnections", `${host}\n[${connections.join()}\n]`));
  }

  pruneNullConnections(): void {
    for (const connectionList of OpenedConnectionTracker.openedConnections.values()) {
      connectionList.removeIf((ref) => !ref.deref());
    }
  }

  static clearCache(): void {
    OpenedConnectionTracker.openedConnections.clear();
  }
}
