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
import { PluginService } from "../../plugin_service";
import { RDSClient } from "@aws-sdk/client-rds";
import { HostInfo } from "../../host_info";
import { WrapperProperties } from "../../wrapper_property";
import { TelemetryCounter } from "../../utils/telemetry/telemetry_counter";
import { ClientWrapper } from "../../client_wrapper";
import { RdsUtils } from "../../utils/rds_utils";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { AwsWrapperError } from "../../utils/errors";
import { RegionUtils } from "../../utils/region_utils";
import { SlidingExpirationCache } from "../../utils/sliding_expiration_cache";
import { sleep } from "../../utils/utils";
import { CustomEndpointMonitor, CustomEndpointMonitorImpl } from "./custom_endpoint_monitor_impl";
import { SubscribedMethodHelper } from "../../utils/subscribed_method_helper";
import { CanReleaseResources } from "../../can_release_resources";

export class CustomEndpointPlugin extends AbstractConnectionPlugin implements CanReleaseResources {
  private static readonly TELEMETRY_WAIT_FOR_INFO_COUNTER = "customEndpoint.waitForInfo.counter";
  private static SUBSCRIBED_METHODS: Set<string> = new Set<string>(SubscribedMethodHelper.NETWORK_BOUND_METHODS);
  private static readonly CACHE_CLEANUP_NANOS = BigInt(60_000_000_000);

  private static readonly rdsUtils = new RdsUtils();
  protected static readonly monitors: SlidingExpirationCache<string, CustomEndpointMonitor> = new SlidingExpirationCache(
    CustomEndpointPlugin.CACHE_CLEANUP_NANOS,
    (monitor: CustomEndpointMonitor) => monitor.shouldDispose(),
    (monitor: CustomEndpointMonitor) => {
      try {
        monitor.close();
      } catch (e) {
        // ignore
      }
    }
  );

  private readonly pluginService: PluginService;
  private readonly props: Map<string, any>;
  private readonly rdsClientFunc: (hostInfo: HostInfo, region: string) => RDSClient;

  private readonly shouldWaitForInfo: boolean;
  private readonly waitOnCachedInfoDurationMs: number;
  private readonly idleMonitorExpirationMs: number;
  private customEndpointHostInfo: HostInfo;
  private customEndpointId: string;
  private region: string;

  private waitForInfoCounter: TelemetryCounter;

  constructor(pluginService: PluginService, props: Map<string, any>, rdsClientFunc?: (hostInfo: HostInfo, region: string) => RDSClient) {
    super();
    this.pluginService = pluginService;
    this.props = props;

    if (rdsClientFunc) {
      this.rdsClientFunc = rdsClientFunc;
    } else {
      this.rdsClientFunc = (hostInfo: HostInfo, region: string) => {
        return new RDSClient({ region: region });
      };
    }

    this.shouldWaitForInfo = WrapperProperties.WAIT_FOR_CUSTOM_ENDPOINT_INFO.get(this.props);
    this.waitOnCachedInfoDurationMs = WrapperProperties.WAIT_FOR_CUSTOM_ENDPOINT_INFO_TIMEOUT_MS.get(this.props);
    this.idleMonitorExpirationMs = WrapperProperties.CUSTOM_ENDPOINT_MONITOR_IDLE_EXPIRATION_MS.get(this.props);

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    this.waitForInfoCounter = telemetryFactory.createCounter(CustomEndpointPlugin.TELEMETRY_WAIT_FOR_INFO_COUNTER);
  }

  getSubscribedMethods(): Set<string> {
    return CustomEndpointPlugin.SUBSCRIBED_METHODS;
  }

  async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    if (!CustomEndpointPlugin.rdsUtils.isRdsCustomClusterDns(hostInfo.host)) {
      return await connectFunc();
    }

    this.customEndpointHostInfo = hostInfo;
    logger.debug(Messages.get("CustomEndpointPlugin.connectionRequestToCustomEndpoint", hostInfo.host));

    this.customEndpointId = CustomEndpointPlugin.rdsUtils.getRdsClusterId(hostInfo.host);
    if (!this.customEndpointId) {
      throw new AwsWrapperError(Messages.get("CustomEndpointPlugin.errorParsingEndpointIdentifier", this.customEndpointHostInfo.host));
    }

    this.region = RegionUtils.getRegion(props.get(WrapperProperties.CUSTOM_ENDPOINT_REGION.name), this.customEndpointHostInfo.host);
    if (!this.region) {
      throw new AwsWrapperError(Messages.get("CustomEndpointPlugin.unableToDetermineRegion", WrapperProperties.CUSTOM_ENDPOINT_REGION.name));
    }

    const monitor: CustomEndpointMonitor = this.createMonitorIfAbsent(props);

    if (this.shouldWaitForInfo) {
      // If needed, wait a short time for custom endpoint info to be discovered.
      await this.waitForCustomEndpointInfo(monitor);
    }

    return await connectFunc();
  }

  createMonitorIfAbsent(props: Map<string, any>): CustomEndpointMonitor {
    return CustomEndpointPlugin.monitors.computeIfAbsent(
      this.customEndpointHostInfo.host,
      (customEndpoint: string) =>
        new CustomEndpointMonitorImpl(
          this.pluginService,
          this.customEndpointHostInfo,
          this.customEndpointId,
          this.region,
          WrapperProperties.CUSTOM_ENDPOINT_INFO_REFRESH_RATE.get(this.props),
          this.rdsClientFunc
        ),
      BigInt(this.idleMonitorExpirationMs * 1000000)
    );
  }

  async waitForCustomEndpointInfo(monitor: CustomEndpointMonitor): Promise<void> {
    let hasCustomEndpointInfo = monitor.hasCustomEndpointInfo();

    if (!hasCustomEndpointInfo) {
      // Wait for the monitor to place the custom endpoint info in the cache. This ensures other plugins get accurate
      // custom endpoint info.
      this.waitForInfoCounter.inc();
      logger.verbose(
        Messages.get("CustomEndpointPlugin.waitingForCustomEndpointInfo", this.customEndpointHostInfo.host, String(this.waitOnCachedInfoDurationMs))
      );

      const waitForEndpointInfoTimeoutMs = Date.now() + this.waitOnCachedInfoDurationMs;
      while (!hasCustomEndpointInfo && Date.now() < waitForEndpointInfoTimeoutMs) {
        await sleep(100);
        hasCustomEndpointInfo = monitor.hasCustomEndpointInfo();
      }

      if (!hasCustomEndpointInfo) {
        throw new AwsWrapperError(
          Messages.get(
            "CustomEndpointPlugin.timedOutWaitingForCustomEndpointInfo",
            String(this.waitOnCachedInfoDurationMs),
            this.customEndpointHostInfo.host
          )
        );
      }
    }
  }

  async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    if (!this.customEndpointHostInfo) {
      return await methodFunc();
    }

    const monitor = this.createMonitorIfAbsent(this.props);
    if (this.shouldWaitForInfo) {
      // If needed, wait a short time for custom endpoint info to be discovered.
      await this.waitForCustomEndpointInfo(monitor);
    }

    return await methodFunc();
  }

  static closeMonitors() {
    logger.info(Messages.get("CustomEndpointPlugin.closeMonitors"));
    // The clear call automatically calls close() on all monitors.
    CustomEndpointPlugin.monitors.clear();
  }

  async releaseResources(): Promise<void> {
    CustomEndpointPlugin.closeMonitors();
  }
}
