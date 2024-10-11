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

export class OpenedConnectionTracker {
  static readonly openedConnections: Map<string, Array<WeakRef<ClientWrapper>>> = new Map<string, Array<WeakRef<ClientWrapper>>>();
  readonly pluginService: PluginService;
  private static readonly rdsUtils = new RdsUtils();

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
  }

  async populateOpenedConnectionQueue(hostInfo: HostInfo, client: ClientWrapper): Promise<void> {
    const aliases = hostInfo.aliases;

    // Check if the connection was established using an instance endpoint
    if (OpenedConnectionTracker.rdsUtils.isRdsInstance(hostInfo.host)) {
      this.trackConnection(hostInfo.getHostAndPort(), client);
      return;
    }

    const instanceEndpoint = [...aliases]
      .filter((x) => OpenedConnectionTracker.rdsUtils.isRdsInstance(OpenedConnectionTracker.rdsUtils.removePort(x)))
      .reduce((max, s) => (s > max ? s : max));

    if (!instanceEndpoint) {
      logger.debug(Messages.get("OpenedConnectionTracker.unableToPopulateOpenedConnectionQueue", hostInfo.host));
      return;
    }

    this.trackConnection(instanceEndpoint, client);
  }

  async invalidateAllConnections(hostInfo: HostInfo): Promise<void> {
    await this.invalidateAllConnectionsMultipleHosts(hostInfo.asAlias);
    await this.invalidateAllConnectionsMultipleHosts(...Array.from(hostInfo.aliases));
  }

  async invalidateAllConnectionsMultipleHosts(...hosts: string[]): Promise<void> {
    try {
      const instanceEndpoint = hosts
        .filter((x) => OpenedConnectionTracker.rdsUtils.isRdsInstance(OpenedConnectionTracker.rdsUtils.removePort(x)))
        .at(0);
      if (!instanceEndpoint) {
        return;
      }
      const connectionQueue = OpenedConnectionTracker.openedConnections.get(instanceEndpoint);
      this.logConnectionQueue(instanceEndpoint, connectionQueue!);
      await this.invalidateConnections(connectionQueue!);
    } catch (error) {
      // ignore
    }
  }

  invalidateCurrentConnection(hostInfo: HostInfo | null, client: ClientWrapper): void {
    const host = OpenedConnectionTracker.rdsUtils.isRdsInstance(hostInfo!.host)
      ? hostInfo!.asAlias
      : [...hostInfo!.aliases].filter((x) => OpenedConnectionTracker.rdsUtils.removePort(x)).at(0);

    if (!host) {
      return;
    }

    const connectionQueue = OpenedConnectionTracker.openedConnections.get(host);
    this.logConnectionQueue(host, connectionQueue!);
    connectionQueue!.filter((x) => x.deref() !== client);
  }

  private trackConnection(instanceEndpoint: string, client: ClientWrapper): void {
    const connectionQueue = MapUtils.computeIfAbsent(
      OpenedConnectionTracker.openedConnections,
      instanceEndpoint,
      (k) => new Array<WeakRef<ClientWrapper>>()
    );
    connectionQueue!.push(new WeakRef<ClientWrapper>(client));
    this.logOpenedConnections();
  }

  private async invalidateConnections(connectionQueue: Array<WeakRef<ClientWrapper>>): Promise<void> {
    let clientRef: WeakRef<ClientWrapper> | undefined;
    while ((clientRef = connectionQueue.shift())) {
      const client = clientRef.deref();
      if (!client) {
        continue;
      }
      await this.pluginService.abortTargetClient(client);
    }
  }

  logOpenedConnections(): void {
    if (logger.level === "debug") {
      let str = "";
      for (const [key, queue] of OpenedConnectionTracker.openedConnections) {
        if (queue.length !== 0) {
          str += JSON.stringify(queue.map((x) => x.deref()!.hostInfo));
          str += "\n\n\t";
        }
      }
      logger.debug(`Opened Connections Tracked: \n\t${str}`);
    }
  }

  private logConnectionQueue(host: string, queue: Array<WeakRef<ClientWrapper>>): void {
    if (!queue || queue.length === 0) {
      return;
    }

    logger.debug(Messages.get("OpenedConnectionTracker.invalidatingConnections", `${host}\n[${queue.map((x) => x.deref()!.hostInfo).join()}\n]`));
  }

  pruneNullConnections(): void {
    for (const [key, queue] of OpenedConnectionTracker.openedConnections) {
      queue.filter((connWeakRef: WeakRef<ClientWrapper>) => connWeakRef);
    }
  }
}
