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

import { PluginService } from "../../plugin_service";
import { HostChangeOptions } from "../../host_change_options";
import { HostInfo } from "../../host_info";
import { OldConnectionSuggestionAction } from "../../old_connection_suggestion_action";
import { RdsUtils } from "../../utils/rds_utils";
import { uniqueId } from "lodash";
import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { RdsUrlType } from "../../utils/rds_url_type";
import { WrapperProperties } from "../../wrapper_property";
import { MonitorConnectionContext } from "./monitor_connection_context";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { MonitorService, MonitorServiceImpl } from "./monitor_service";
import { AwsWrapperError } from "../../utils/errors";
import { HostListProvider } from "../../host_list_provider/host_list_provider";
import { HostAvailability } from "../../host_availability/host_availability";
import { CanReleaseResources } from "../../can_release_resources";
import { SubscribedMethodHelper } from "../../utils/subscribed_method_helper";

export class HostMonitoringConnectionPlugin extends AbstractConnectionPlugin implements CanReleaseResources {
  id: string = uniqueId("_efmPlugin");
  private readonly properties: Map<string, any>;
  private pluginService: PluginService;
  private rdsUtils: RdsUtils;
  private monitoringHostInfo: HostInfo | null = null;
  private monitorService: MonitorService;

  constructor(pluginService: PluginService, properties: Map<string, any>, rdsUtils: RdsUtils = new RdsUtils(), monitorService?: MonitorServiceImpl) {
    super();
    this.pluginService = pluginService;
    this.properties = properties;
    this.rdsUtils = rdsUtils;
    this.monitorService = monitorService ?? new MonitorServiceImpl(pluginService);
  }

  getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, connectFunc);
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, forceConnectFunc);
  }

  private async connectInternal<T>(hostInfo: HostInfo, connectFunc: () => Promise<T>): Promise<T> {
    const targetClient = await connectFunc();
    if (targetClient != null) {
      const type: RdsUrlType = this.rdsUtils.identifyRdsType(hostInfo.host);
      if (type.isRdsCluster) {
        hostInfo.resetAliases();
        await this.pluginService.fillAliases(targetClient, hostInfo);
      }
    }
    return targetClient;
  }

  async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any): Promise<T> {
    const isEnabled: boolean = WrapperProperties.FAILURE_DETECTION_ENABLED.get(this.properties) as boolean;

    if (!isEnabled || !SubscribedMethodHelper.NETWORK_BOUND_METHODS.includes(methodName)) {
      return methodFunc();
    }

    const failureDetectionTimeMillis: number = WrapperProperties.FAILURE_DETECTION_TIME_MS.get(this.properties) as number;
    const failureDetectionIntervalMillis: number = WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.get(this.properties) as number;
    const failureDetectionCount: number = WrapperProperties.FAILURE_DETECTION_COUNT.get(this.properties) as number;

    let result: T;
    let monitorContext: MonitorConnectionContext | null = null;

    try {
      logger.debug(Messages.get("HostMonitoringConnectionPlugin.activatedMonitoring", methodName));
      const monitoringHostInfo: HostInfo = await this.getMonitoringHostInfo();

      monitorContext = await this.monitorService.startMonitoring(
        this.pluginService.getCurrentClient().targetClient,
        monitoringHostInfo.allAliases,
        monitoringHostInfo,
        this.properties,
        failureDetectionTimeMillis,
        failureDetectionIntervalMillis,
        failureDetectionCount
      );
      result = await methodFunc();
    } finally {
      if (monitorContext != null) {
        await this.monitorService.stopMonitoring(monitorContext);

        if (monitorContext.isHostUnhealthy) {
          const monitoringHostInfo = await this.getMonitoringHostInfo();
          if (monitoringHostInfo) {
            this.pluginService.setAvailability(monitoringHostInfo.allAliases, HostAvailability.NOT_AVAILABLE);
          }

          const isClientClosed = await this.pluginService.isClientValid(this.pluginService.getCurrentClient().targetClient);

          if (!isClientClosed) {
            await this.pluginService.getCurrentClient().end();
            // eslint-disable-next-line no-unsafe-finally
            throw new AwsWrapperError(Messages.get("HostMonitoringConnectionPlugin.unavailableHost", monitoringHostInfo.host));
          }
        }
      }
    }

    return result;
  }

  async getMonitoringHostInfo(): Promise<HostInfo> {
    function throwUnableToIdentifyConnection(host: HostInfo | null, provider: HostListProvider | null): never {
      throw new AwsWrapperError(
        Messages.get(
          "HostMonitoringConnectionPlugin.unableToIdentifyConnection",
          host != null ? host.host : "unknown host",
          provider != null ? provider.getHostProviderType() : "unknown provider"
        )
      );
    }

    if (this.monitoringHostInfo == null) {
      this.monitoringHostInfo = this.pluginService.getCurrentHostInfo();
      const provider: HostListProvider | null = this.pluginService.getHostListProvider();
      if (this.monitoringHostInfo == null) {
        throwUnableToIdentifyConnection(null, provider);
      }
      const rdsUrlType: RdsUrlType = this.rdsUtils.identifyRdsType(this.monitoringHostInfo.url);

      try {
        if (rdsUrlType.isRdsCluster) {
          logger.debug("Monitoring host info is associated with a cluster endpoint, plugin needs to identify the cluster connection");
          this.monitoringHostInfo = await this.pluginService.identifyConnection(this.pluginService.getCurrentClient().targetClient);
          if (this.monitoringHostInfo == null) {
            const host: HostInfo | null = this.pluginService.getCurrentHostInfo();
            throwUnableToIdentifyConnection(host, provider);
          }
          await this.pluginService.fillAliases(this.pluginService.getCurrentClient(), this.monitoringHostInfo);
        }
      } catch (error: any) {
        logger.debug(Messages.get("HostMonitoringConnectionPlugin.errorIdentifyingConnection", error.message));
        throw error;
      }
    }

    return this.monitoringHostInfo;
  }

  async notifyConnectionChanged(changes: Set<HostChangeOptions>): Promise<OldConnectionSuggestionAction> {
    if (changes.has(HostChangeOptions.WENT_DOWN) || changes.has(HostChangeOptions.HOST_DELETED)) {
      const aliases = (await this.getMonitoringHostInfo())?.allAliases;
      if (aliases && aliases.size > 0) {
        this.monitorService.stopMonitoringForAllConnections(aliases);
      }
    }

    // Reset monitoring host info since the associated connection has changed.
    this.monitoringHostInfo = null;
    return OldConnectionSuggestionAction.NO_OPINION;
  }

  async releaseResources(): Promise<void> {
    const hostKeys = (await this.getMonitoringHostInfo())?.allAliases;
    await this.monitorService.releaseResources(hostKeys);

    return Promise.resolve();
  }
}
