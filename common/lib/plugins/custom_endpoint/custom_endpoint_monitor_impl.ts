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

import { DescribeDBClusterEndpointsCommand, RDSClient } from "@aws-sdk/client-rds";
import { HostInfo } from "../../host_info";
import { PluginService } from "../../plugin_service";
import { TelemetryCounter } from "../../utils/telemetry/telemetry_counter";
import { logger } from "../../../logutils";
import { CustomEndpointInfo } from "./custom_endpoint_info";
import { AllowedAndBlockedHosts } from "../../allowed_and_blocked_hosts";
import { CacheMap } from "../../utils/cache_map";
import { MemberListType } from "./member_list_type";
import { Messages } from "../../utils/messages";
import { clearTimeout } from "node:timers";
import { AwsWrapperError } from "../../utils/errors";

export interface CustomEndpointMonitor {
  shouldDispose(): boolean;
  hasCustomEndpointInfo(): boolean;
  close(): void;
}

export class CustomEndpointMonitorImpl implements CustomEndpointMonitor {
  private static readonly TELEMETRY_ENDPOINT_INFO_CHANGED = "customEndpoint.infoChanged.counter";

  // Keys are custom endpoint URLs, values are information objects for the associated custom endpoint.
  private static readonly CUSTOM_ENDPOINT_INFO_EXPIRATION_NANO = 5 * 60_000_000_000; // 5 minutes

  protected static customEndpointInfoCache: CacheMap<string, CustomEndpointInfo> = new CacheMap();

  private rdsClient: RDSClient;
  private customEndpointHostInfo: HostInfo;
  private readonly endpointIdentifier: string;
  private readonly region: string;
  private readonly refreshRateMs: number;

  private pluginService: PluginService;
  private infoChangedCounter: TelemetryCounter;

  protected stop = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    pluginService: PluginService,
    customEndpointHostInfo: HostInfo,
    endpointIdentifier: string,
    region: string,
    refreshRateMs: number,
    rdsClientFunc: (hostInfo: HostInfo, region: string) => RDSClient
  ) {
    this.pluginService = pluginService;
    this.customEndpointHostInfo = customEndpointHostInfo;
    this.endpointIdentifier = endpointIdentifier;
    this.region = region;
    this.refreshRateMs = refreshRateMs;
    this.rdsClient = rdsClientFunc(customEndpointHostInfo, this.region);

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    this.infoChangedCounter = telemetryFactory.createCounter(CustomEndpointMonitorImpl.TELEMETRY_ENDPOINT_INFO_CHANGED);

    this.run();
  }

  async run(): Promise<void> {
    logger.verbose(Messages.get("CustomEndpointMonitorImpl.startingMonitor", this.customEndpointHostInfo.host));

    while (!this.stop) {
      try {
        const start = Date.now();

        const input = {
          DBClusterEndpointIdentifier: this.endpointIdentifier,
          Filters: [
            {
              Name: "db-cluster-endpoint-type",
              Values: ["custom"]
            }
          ]
        };
        const command = new DescribeDBClusterEndpointsCommand(input);
        const result = await this.rdsClient.send(command);

        const endpoints = result.DBClusterEndpoints;

        if (endpoints.length === 0) {
          throw new AwsWrapperError(Messages.get("CustomEndpointMonitorImpl.noEndpoints"));
        }

        if (endpoints.length !== 1) {
          let endpointUrls = "";
          endpoints.forEach((endpoint) => {
            endpointUrls += `\n\t${endpoint.Endpoint}`;
          });
          logger.warn(
            Messages.get(
              "CustomEndpointMonitorImpl.unexpectedNumberOfEndpoints",
              this.endpointIdentifier,
              this.region,
              String(endpoints.length),
              endpointUrls
            )
          );
          await new Promise((resolve) => {
            this.timers.push(setTimeout(resolve, this.refreshRateMs));
          });
          continue;
        }

        const endpointInfo = CustomEndpointInfo.fromDbClusterEndpoint(endpoints[0]);
        const cachedEndpointInfo = CustomEndpointMonitorImpl.customEndpointInfoCache.get(this.customEndpointHostInfo.host);

        if (cachedEndpointInfo && cachedEndpointInfo.equals(endpointInfo)) {
          const elapsedTime = Date.now() - start;
          const sleepDuration = Math.max(0, this.refreshRateMs - elapsedTime);
          await new Promise((resolve) => {
            this.timers.push(setTimeout(resolve, sleepDuration));
          });
          continue;
        }

        logger.verbose(
          Messages.get("CustomEndpointMonitorImpl.detectedChangeInCustomEndpointInfo", this.customEndpointHostInfo.host, endpointInfo.toString())
        );

        // The custom endpoint info has changed, so we need to update the set of allowed/blocked hosts.
        let allowedAndBlockedHosts: AllowedAndBlockedHosts;
        if (endpointInfo.getMemberListType() === MemberListType.STATIC_LIST) {
          allowedAndBlockedHosts = new AllowedAndBlockedHosts(endpointInfo.getStaticMembers(), null);
        } else {
          allowedAndBlockedHosts = new AllowedAndBlockedHosts(null, endpointInfo.getExcludedMembers());
        }

        this.pluginService.setAllowedAndBlockedHosts(allowedAndBlockedHosts);
        CustomEndpointMonitorImpl.customEndpointInfoCache.put(
          this.customEndpointHostInfo.host,
          endpointInfo,
          CustomEndpointMonitorImpl.CUSTOM_ENDPOINT_INFO_EXPIRATION_NANO
        );
        this.infoChangedCounter.inc();

        const elapsedTime = Date.now() - start;
        const sleepDuration = Math.max(0, this.refreshRateMs - elapsedTime);
        await new Promise((resolve) => {
          this.timers.push(setTimeout(resolve, sleepDuration));
        });
      } catch (e: any) {
        logger.error(Messages.get("CustomEndpointMonitorImpl.error", this.customEndpointHostInfo.host, e.message));
        throw e;
      }
    }
  }

  hasCustomEndpointInfo(): boolean {
    return CustomEndpointMonitorImpl.customEndpointInfoCache.get(this.customEndpointHostInfo.host) != null;
  }

  shouldDispose(): boolean {
    return true;
  }

  close(): void {
    logger.verbose(Messages.get("CustomEndpointMonitorImpl.stoppingMonitor", this.customEndpointHostInfo.host));
    this.stop = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    CustomEndpointMonitorImpl.customEndpointInfoCache.delete(this.customEndpointHostInfo.host);
    this.rdsClient.destroy();
    logger.verbose(Messages.get("CustomEndpointMonitorImpl.stoppedMonitor", this.customEndpointHostInfo.host));
  }
}
