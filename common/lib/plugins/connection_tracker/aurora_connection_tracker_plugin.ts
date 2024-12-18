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
  private static readonly subscribedMethods = new Set<string>(["notifyHostListChanged"].concat(SubscribedMethodHelper.NETWORK_BOUND_METHODS));

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
    return this.connectInternal(hostInfo, connectFunc);
  }

  override async forceConnect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(hostInfo, forceConnectFunc);
  }

  async connectInternal(hostInfo: HostInfo, connectFunc: () => Promise<ClientWrapper>): Promise<ClientWrapper> {
    const targetClient = await connectFunc();

    if (targetClient) {
      const type: RdsUrlType = this.rdsUtils.identifyRdsType(hostInfo.host);
      if (type.isRdsCluster) {
        hostInfo.resetAliases();
        await this.pluginService.fillAliases(targetClient, hostInfo);
      }
      await this.tracker.populateOpenedConnectionQueue(hostInfo, targetClient);
    }
    return targetClient;
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    this.rememberWriter();

    try {
      const result = await methodFunc();
      if (this.needUpdateCurrentWriter) {
        await this.checkWriterChanged();
      }
      return result;
    } catch (error) {
      if (error instanceof FailoverError) {
        await this.checkWriterChanged();
      }
      throw error;
    }
  }

  private async checkWriterChanged(): Promise<void> {
    const hostInfoAfterFailover = this.getWriter(this.pluginService.getHosts());
    if (this.currentWriter === null) {
      this.currentWriter = hostInfoAfterFailover;
      this.needUpdateCurrentWriter = false;
    } else if (!this.currentWriter.equals(hostInfoAfterFailover!)) {
      // writer changed
      await this.tracker.invalidateAllConnections(this.currentWriter);
      this.tracker.logOpenedConnections();
      this.currentWriter = hostInfoAfterFailover;
      this.needUpdateCurrentWriter = false;
    }
  }

  private rememberWriter(): void {
    if (this.currentWriter === null || this.needUpdateCurrentWriter) {
      this.currentWriter = this.getWriter(this.pluginService.getHosts());
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
