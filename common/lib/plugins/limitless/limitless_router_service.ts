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
import { LimitlessRouterMonitor } from "./limitless_router_monitor";
import { SlidingExpirationCache } from "../../utils/sliding_expiration_cache";
import { WrapperProperties } from "../../wrapper_property";
import { AwsWrapperError, UnsupportedStrategyError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { LimitlessQueryHelper } from "./limitless_query_helper";
import { Mutex } from "async-mutex";
import { MapUtils } from "../../utils/map_utils";
import { LimitlessConnectionContext } from "./limitless_connection_context";
import { logger } from "../../../logutils";
import { RoundRobinHostSelector } from "../../round_robin_host_selector";
import { HostRole } from "../../host_role";
import { HostAvailability } from "../../host_availability/host_availability";
import { HighestWeightHostSelector } from "../../highest_weight_host_selector";
import { sleep } from "../../utils/utils";
import { SlidingExpirationCacheWithCleanupTask } from "../../utils/sliding_expiration_cache_with_cleanup_task";

export interface LimitlessRouterService {
  startMonitor(hostInfo: HostInfo, properties: Map<string, any>): void;

  establishConnection(context: LimitlessConnectionContext): Promise<void>;
}

export class LimitlessRouterServiceImpl implements LimitlessRouterService {
  protected static readonly CACHE_CLEANUP_NANOS = BigInt(60_000_000_000); // 1 min
  protected static readonly monitors: SlidingExpirationCacheWithCleanupTask<string, LimitlessRouterMonitor> =
    new SlidingExpirationCacheWithCleanupTask(
      LimitlessRouterServiceImpl.CACHE_CLEANUP_NANOS,
      undefined,
      async (monitor: LimitlessRouterMonitor) => await monitor.close(),
      "LimitlessRouterServiceImpl.monitors"
    );
  protected static readonly limitlessRouterCache: SlidingExpirationCache<string, HostInfo[]> = new SlidingExpirationCache(
    LimitlessRouterServiceImpl.CACHE_CLEANUP_NANOS,
    undefined,
    async (hosts) => {}
  );
  protected static readonly forceGetLimitlessRoutersLockMap = new Map<string, Mutex>();

  private readonly routerMonitorSupplier = (pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, intervalMillis: number) =>
    new LimitlessRouterMonitor(
      pluginService,
      hostInfo,
      LimitlessRouterServiceImpl.limitlessRouterCache,
      pluginService.getHostListProvider()!.getClusterId(),
      properties,
      intervalMillis
    );

  protected readonly pluginService: PluginService;
  protected readonly queryHelper: LimitlessQueryHelper = new LimitlessQueryHelper();

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
  }

  public async establishConnection(context: LimitlessConnectionContext): Promise<void> {
    context.setRouters(this.getLimitlessRouters(context.getProperties()));

    if (!context.getRouters() || context.getRouters().length === 0) {
      logger.debug(Messages.get("LimitlessRouterServiceImpl.limitlessRouterCacheEmpty"));
      const waitForRouterInfo = WrapperProperties.WAIT_F0R_ROUTER_INFO.get(context.getProperties());
      if (waitForRouterInfo) {
        await this.synchronouslyGetLimitlessRoutersWithRetry(context);
      } else {
        logger.debug(Messages.get("LimitlessRouterServiceImpl.usingProvidedConnectUrl"));
        if (!context.getConnection()) {
          context.setConnection(await context.getConnectFunc()());
        }
        return;
      }
    }

    if (context.getRouters() && context.getRouters().some((h: HostInfo) => h.equals(context.getHostInfo()))) {
      logger.debug(Messages.get("LimitlessRouterServiceImpl.connectWithHost", context.getHostInfo().host));
      if (!context.getConnection()) {
        try {
          context.setConnection(await context.getConnectFunc()());
        } catch (e) {
          await this.retryConnectWithLeastLoadedRouters(context);
        }
      }
      return;
    }

    RoundRobinHostSelector.setRoundRobinHostWeightPairsProperty(context.getRouters(), context.getProperties());
    let selectedHostSpec: HostInfo | undefined;
    try {
      selectedHostSpec = this.pluginService.getHostInfoByStrategy(HostRole.WRITER, RoundRobinHostSelector.STRATEGY_NAME, context.getRouters());
      logger.debug(Messages.get("LimitlessRouterServiceImpl.selectedHost", selectedHostSpec ? selectedHostSpec.host : "undefined"));
    } catch (error: any) {
      await this.retryConnectWithLeastLoadedRouters(context);
      return;
    }

    if (!selectedHostSpec) {
      await this.retryConnectWithLeastLoadedRouters(context);
      return;
    }

    try {
      context.setConnection(await this.pluginService.connect(selectedHostSpec, context.getProperties(), context.getPlugin()));
    } catch (e) {
      logger.debug(Messages.get("LimitlessRouterServiceImpl.failedToConnectToHost", selectedHostSpec.host));
      selectedHostSpec.setAvailability(HostAvailability.NOT_AVAILABLE);

      // Retry connect prioritising the healthiest router for best chance of connection over load-balancing with round-robin
      await this.retryConnectWithLeastLoadedRouters(context);
    }
  }

  protected getLimitlessRouters(properties: Map<string, any>): HostInfo[] | undefined {
    const cacheExpirationNano = BigInt(WrapperProperties.LIMITLESS_MONITOR_DISPOSAL_TIME_MS.get(properties) * 1_000_000);
    const clusterId = this.pluginService.getHostListProvider()!.getClusterId();
    return LimitlessRouterServiceImpl.limitlessRouterCache.get(clusterId, cacheExpirationNano);
  }

  protected async retryConnectWithLeastLoadedRouters(context: LimitlessConnectionContext): Promise<void> {
    let remainingAttempts: number = WrapperProperties.MAX_RETRIES.get(context.getProperties());
    while (remainingAttempts-- > 0) {
      if (
        !context.getRouters() ||
        context.getRouters().length === 0 ||
        !context.getRouters().some((h) => h.getAvailability() === HostAvailability.AVAILABLE)
      ) {
        await this.synchronouslyGetLimitlessRoutersWithRetry(context);
        if (
          !context.getRouters() ||
          context.getRouters().length === 0 ||
          !context.getRouters().some((h) => h.getAvailability() === HostAvailability.AVAILABLE)
        ) {
          logger.warn(Messages.get("LimitlessRouterServiceImpl.noRoutersAvailableForRetry"));
          if (context.getConnection()) {
            return;
          } else {
            try {
              context.setConnection(await context.getConnectFunc()());
              return;
            } catch (e) {
              throw new AwsWrapperError(Messages.get("LimitlessRouterServiceImpl.noRoutersAvailable"));
            }
          }
        }
      }

      let selectedHostSpec: HostInfo | undefined = undefined;
      try {
        // Select healthiest router for best chance of connection over load-balancing with round-robin
        selectedHostSpec = this.pluginService.getHostInfoByStrategy(HostRole.WRITER, HighestWeightHostSelector.STRATEGY_NAME, context.getRouters());
        logger.debug(Messages.get("LimitlessRouterServiceImpl.selectedHostForRetry", selectedHostSpec ? selectedHostSpec.host : "undefined"));
        if (!selectedHostSpec) {
          continue;
        }
      } catch (e) {
        if (e instanceof UnsupportedStrategyError) {
          logger.error(Messages.get("LimitlessRouterServiceImpl.incorrectConfiguration"));
          throw e;
        }
        // error from host selector
        continue;
      }

      try {
        context.setConnection(await this.pluginService.connect(selectedHostSpec, context.getProperties(), context.getPlugin()));
        if (context.getConnection()) {
          return;
        }
      } catch (error) {
        selectedHostSpec.setAvailability(HostAvailability.NOT_AVAILABLE);
        logger.debug(Messages.get("LimitlessRouterServiceImpl.failedToConnectToHost", selectedHostSpec.host));
      }
    }
    throw new AwsWrapperError(Messages.get("LimitlessRouterServiceImpl.maxRetriesExceeded"));
  }

  protected async synchronouslyGetLimitlessRoutersWithRetry(context: LimitlessConnectionContext): Promise<void> {
    logger.debug(Messages.get("LimitlessRouterServiceImpl.synchronouslyGetLimitlessRouters"));

    let remainingAttempts: number = WrapperProperties.GET_ROUTER_MAX_RETRIES.get(context.getProperties());
    const retryIntervalMs = WrapperProperties.GET_ROUTER_RETRY_INTERVAL_MILLIS.get(context.getProperties());

    do {
      try {
        await this.synchronouslyGetLimitlessRouters(context);
        if (context.getRouters() && context.getRouters().length > 0) {
          return;
        }
        await sleep(retryIntervalMs);
      } catch (e) {
        logger.debug(Messages.get("LimitlessRouterServiceImpl.getLimitlessRoutersError", e.message));
      }
    } while (remainingAttempts-- >= 0);

    throw new AwsWrapperError(Messages.get("LimitlessRouterServiceImpl.noRoutersAvailable"));
  }

  protected async synchronouslyGetLimitlessRouters(context: LimitlessConnectionContext): Promise<void> {
    const cacheExpirationNano = BigInt(WrapperProperties.LIMITLESS_MONITOR_DISPOSAL_TIME_MS.get(context.getProperties()));
    const clusterId = this.pluginService.getHostListProvider()!.getClusterId();

    const mutex = MapUtils.computeIfAbsent(LimitlessRouterServiceImpl.forceGetLimitlessRoutersLockMap, clusterId, (k) => new Mutex());

    await mutex!.runExclusive(async () => {
      const limitlessRouters = LimitlessRouterServiceImpl.limitlessRouterCache.get(clusterId, cacheExpirationNano);
      if (limitlessRouters && limitlessRouters.length > 0) {
        context.setRouters(limitlessRouters);
        return;
      }

      if (!context.getConnection()) {
        context.setConnection(await context.getConnectFunc()());
      }
      const newLimitlessRouters = await this.queryHelper.queryForLimitlessRouters(this.pluginService, context.getConnection(), context.getHostInfo());
      if (newLimitlessRouters && newLimitlessRouters.length > 0) {
        context.setRouters(newLimitlessRouters);
        LimitlessRouterServiceImpl.limitlessRouterCache.put(clusterId, newLimitlessRouters, cacheExpirationNano);
      } else {
        throw new AwsWrapperError(Messages.get("LimitlessRouterServiceImpl.fetchedEmptyRouterList"));
      }
    });
  }

  public startMonitor(hostInfo: HostInfo, properties: Map<string, any>): void {
    const cacheExpirationNano = BigInt(WrapperProperties.LIMITLESS_MONITOR_DISPOSAL_TIME_MS.get(properties) * 1_000_000);
    let monitor: LimitlessRouterMonitor | null = null;
    try {
      monitor = LimitlessRouterServiceImpl.monitors.computeIfAbsent(
        this.pluginService.getHostListProvider()!.getClusterId(),
        (key) => this.routerMonitorSupplier(this.pluginService, hostInfo, properties, WrapperProperties.INTERVAL_MILLIS.get(properties)),
        cacheExpirationNano
      );
    } catch (e) {
      throw new AwsWrapperError(Messages.get("LimitlessRouterServiceImpl.errorStartingMonitor", e.message));
    }
    if (!monitor) {
      throw new AwsWrapperError(
        Messages.get("LimitlessRouterServiceImpl.nullLimitlessRouterMonitor", this.pluginService.getHostListProvider()!.getClusterId())
      );
    }
  }

  static async clearMonitors() {
    await LimitlessRouterServiceImpl.monitors.clear();
  }
}
