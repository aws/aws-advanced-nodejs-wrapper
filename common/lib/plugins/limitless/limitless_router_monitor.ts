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
import { PluginService } from "../../plugin_service";
import { WrapperProperties } from "../../wrapper_property";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { ClientWrapper } from "../../client_wrapper";
import { logTopology, sleep } from "../../utils/utils";
import { RoundRobinHostSelector } from "../../round_robin_host_selector";
import { SlidingExpirationCache } from "../../utils/sliding_expiration_cache";
import { LimitlessQueryHelper } from "./limitless_query_helper";
import { TelemetryFactory } from "../../utils/telemetry/telemetry_factory";
import { TelemetryTraceLevel } from "../../utils/telemetry/telemetry_trace_level";

export class LimitlessRouterMonitor {
  protected static readonly MONITORING_PROPERTY_PREFIX: string = "limitless_router_monitor_";

  protected readonly pluginService: PluginService;
  protected readonly hostInfo: HostInfo;
  protected readonly props: Map<string, any>;
  protected readonly intervalMillis: number;

  protected readonly limitlessRouterCache: SlidingExpirationCache<string, HostInfo[]>;
  protected limitlessRouterCacheKey: string;
  protected queryHelper: LimitlessQueryHelper = new LimitlessQueryHelper();
  protected stopped: boolean = false;
  protected monitoringClient: ClientWrapper | null = null;
  protected telemetryFactory: TelemetryFactory;

  constructor(
    pluginService: PluginService,
    hostInfo: HostInfo,
    limitlessRouterCache: SlidingExpirationCache<string, HostInfo[]>,
    limitlessRouterCacheKey: string,
    properties: Map<string, any>,
    intervalMillis: number
  ) {
    this.pluginService = pluginService;
    this.hostInfo = hostInfo;
    this.limitlessRouterCache = limitlessRouterCache;
    this.limitlessRouterCacheKey = limitlessRouterCacheKey;
    this.props = new Map(properties);
    this.intervalMillis = intervalMillis;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();

    for (const key of properties.keys()) {
      if (!key.startsWith(LimitlessRouterMonitor.MONITORING_PROPERTY_PREFIX)) {
        continue;
      }
      this.props.set(key.substring(LimitlessRouterMonitor.MONITORING_PROPERTY_PREFIX.length), properties.get(key));
      this.props.delete(key);
    }
    WrapperProperties.WAIT_F0R_ROUTER_INFO.set(this.props, false);

    this.run();
  }

  async close(): Promise<void> {
    this.stopped = true;
    await sleep(500);
    logger.debug(Messages.get("LimitlessRouterMonitor.stopped", this.hostInfo.host));
  }

  async run(): Promise<void> {
    logger.debug(Messages.get("LimitlessRouterMonitor.running", this.hostInfo.host));

    while (!this.stopped) {
      const telemetryContext = this.telemetryFactory.openTelemetryContext("limitless router monitor task", TelemetryTraceLevel.TOP_LEVEL);
      telemetryContext.setAttribute("url", this.hostInfo.host);
      await telemetryContext.start(async () => {
        try {
          await this.openConnection();
          if (!this.monitoringClient) {
            return;
          }
          const clientIsValid = await this.pluginService.isClientValid(this.monitoringClient);
          if (!clientIsValid) {
            this.monitoringClient = null;
            return;
          }

          const newLimitlessRouters = await this.queryHelper.queryForLimitlessRouters(this.pluginService, this.monitoringClient, this.hostInfo);

          if (newLimitlessRouters && newLimitlessRouters.length > 0) {
            this.limitlessRouterCache.put(
              this.limitlessRouterCacheKey,
              newLimitlessRouters,
              BigInt(WrapperProperties.MONITOR_DISPOSAL_TIME_MS.get(this.props))
            );

            RoundRobinHostSelector.setRoundRobinHostWeightPairsProperty(newLimitlessRouters, this.props);
            logger.debug(logTopology(newLimitlessRouters, "[limitlessRouterMonitor] "));
          }
          await sleep(this.intervalMillis);
        } catch (e: any) {
          logger.debug(Messages.get("LimitlessRouterMonitor.errorDuringMonitoringStop", this.hostInfo.host, e.message));
        }
      });
    }
  }

  async openConnection(): Promise<void> {
    try {
      if (this.monitoringClient) {
        const clientIsValid = await this.pluginService.isClientValid(this.monitoringClient);
        if (clientIsValid) {
          return;
        }
      }
      logger.debug(Messages.get("LimitlessRouterMonitor.openingConnection", this.hostInfo.url));
      this.monitoringClient = await this.pluginService.forceConnect(this.hostInfo, this.props);
      logger.debug(Messages.get("LimitlessRouterMonitor.openedConnection", this.hostInfo.url));
    } catch (e) {
      if (this.monitoringClient) {
        await this.monitoringClient.end();
      }
      this.monitoringClient = null;
    }
  }
}
