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

import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { CanReleaseResources } from "../../can_release_resources";
import { SubscribedMethodHelper } from "../../utils/subscribed_method_helper";
import { PluginService } from "../../plugin_service";
import { RdsUtils } from "../../utils/rds_utils";
import { HostInfo } from "../../host_info";
import { ClientWrapper } from "../../client_wrapper";
import { RdsUrlType } from "../../utils/rds_url_type";
import { FailoverError } from "../../utils/errors";
import { HostChangeOptions } from "../../host_change_options";
import { HostRole } from "../../host_role";
import { OpenedConnectionTracker } from "./opened_connection_tracker";

export class AuroraConnectionTrackerPlugin extends AbstractConnectionPlugin implements CanReleaseResources {
  private static readonly subscribedMethods = new Set<string>([
    ...SubscribedMethodHelper.NETWORK_BOUND_METHODS,
    "end",
    "abort",
    "notifyHostListChanged"
  ]);
  private static readonly CLOSING_METHODS = new Set<string>(["end", "abort"]);
  private static readonly TOPOLOGY_CHANGES_EXPECTED_TIME_NS = BigInt(3 * 60 * 1_000_000_000);
  private static hostListRefreshEndTimeNs: bigint = 0n;

  private readonly pluginService: PluginService;
  private readonly rdsUtils: RdsUtils;
  private readonly tracker: OpenedConnectionTracker;
  private currentWriter: HostInfo | null = null;
  private needUpdateCurrentWriter: boolean = false;

  constructor(pluginService: PluginService);
  constructor(pluginService: PluginService, rdsUtils: RdsUtils, tracker: OpenedConnectionTracker);
  constructor(pluginService: PluginService, rdsUtils?: RdsUtils, tracker?: OpenedConnectionTracker) {
    super();
    this.pluginService = pluginService;
    this.rdsUtils = rdsUtils ?? new RdsUtils();
    this.tracker = tracker ?? new OpenedConnectionTracker(pluginService);
  }

  override getSubscribedMethods(): Set<string> {
    return AuroraConnectionTrackerPlugin.subscribedMethods;
  }

  override async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    const targetClient = await connectFunc();
    let connectionHostInfo: HostInfo = this.pluginService.getRoutedHostInfo() ?? hostInfo;

    if (targetClient && !this.pluginService.isPooledClient()) {
      const type: RdsUrlType = this.rdsUtils.identifyRdsType(connectionHostInfo.host);
      if (type.isRdsCluster || type === RdsUrlType.OTHER || type === RdsUrlType.IP_ADDRESS) {
        const identifiedHostInfo: HostInfo | null = await this.pluginService.identifyConnection(targetClient, connectionHostInfo);
        if (identifiedHostInfo) {
          connectionHostInfo = identifiedHostInfo;
          await this.pluginService.setRoutedHostInfo(connectionHostInfo);
        }
      }
      const host = this.tracker.populateOpenedConnectionQueue(connectionHostInfo, targetClient);
      this.pluginService.setTrackedConnectionHost(host);    }
    return targetClient;
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    const currentHostInfo = this.pluginService.getCurrentHostInfo();
    this.rememberWriter();

    const isClosing = AuroraConnectionTrackerPlugin.CLOSING_METHODS.has(methodName);

    try {
      if (!isClosing) {
        let needRefreshHostList = false;
        const localRefreshEndTimeNs = AuroraConnectionTrackerPlugin.hostListRefreshEndTimeNs;
        if (localRefreshEndTimeNs > 0n) {
          if (localRefreshEndTimeNs > process.hrtime.bigint()) {
            needRefreshHostList = true;
          } else {
            AuroraConnectionTrackerPlugin.hostListRefreshEndTimeNs = 0n;
          }
        }
        if (this.needUpdateCurrentWriter || needRefreshHostList) {
          await this.checkWriterChanged(needRefreshHostList);
        }
      }

      const result = await methodFunc();

      if (isClosing) {
        const host = this.pluginService.getTrackedConnectionHost();
        if (host) {
          this.tracker.removeConnectionTracking(host);
          this.pluginService.setTrackedConnectionHost(null);
        } else if (currentHostInfo) {
          this.tracker.removeConnectionTrackingByHost(currentHostInfo, this.pluginService.getCurrentClient()?.targetClient);
        }
      }
      return result;
    } catch (error) {
      if (error instanceof FailoverError) {
        AuroraConnectionTrackerPlugin.hostListRefreshEndTimeNs =
          process.hrtime.bigint() + AuroraConnectionTrackerPlugin.TOPOLOGY_CHANGES_EXPECTED_TIME_NS;
        // This call may effectively close/abort the current connection.
        await this.checkWriterChanged(true);
      }
      throw error;
    }
  }

  private async checkWriterChanged(needRefreshHostList: boolean): Promise<void> {
    if (needRefreshHostList) {
      try {
        await this.pluginService.refreshHostList();
      } catch (error) {
        // Ignore: continue with whatever topology is currently available.
      }
    }

    const hostInfoAfterFailover = this.getWriter(this.pluginService.getAllHosts());
    if (hostInfoAfterFailover === null) {
      return;
    }

    if (this.currentWriter === null) {
      this.currentWriter = hostInfoAfterFailover;
      this.needUpdateCurrentWriter = false;
    } else if (this.currentWriter.hostAndPort !== hostInfoAfterFailover.hostAndPort) {
      // The writer changed.
      await this.tracker.invalidateAllConnections(this.currentWriter);
      this.tracker.logOpenedConnections();
      this.currentWriter = hostInfoAfterFailover;
      this.needUpdateCurrentWriter = false;
      AuroraConnectionTrackerPlugin.hostListRefreshEndTimeNs = 0n;
    }
  }

  private rememberWriter(): void {
    if (this.currentWriter === null || this.needUpdateCurrentWriter) {
      this.currentWriter = this.getWriter(this.pluginService.getAllHosts());
      this.needUpdateCurrentWriter = false;
    }
  }

  private getWriter(hosts: HostInfo[]): HostInfo | null {
    return hosts.find((x) => x.role === HostRole.WRITER) ?? null;
  }

  async notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): Promise<void> {
    for (const [key, _] of changes.entries()) {
      const hostChanges = changes.get(key);

      if (hostChanges) {
        if (hostChanges.has(HostChangeOptions.PROMOTED_TO_READER)) {
          await this.tracker.invalidateAllConnectionsMultipleHosts(key);
        }

        if (hostChanges.has(HostChangeOptions.PROMOTED_TO_WRITER)) {
          this.needUpdateCurrentWriter = true;
        }
      }
    }
  }

  async releaseResources() {
    this.tracker.pruneNullConnections();
  }
}
