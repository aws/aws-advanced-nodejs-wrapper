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

import { CacheMap } from "../../../utils/cache_map";
import { ClientWrapper } from "../../../client_wrapper";
import { HostRole } from "../../../host_role";
import { AbstractConnectionPlugin } from "../../../abstract_connection_plugin";
import { HostResponseTimeService, HostResponseTimeServiceImpl } from "./host_response_time_service";
import { PluginService } from "../../../plugin_service";
import { WrapperProperties } from "../../../wrapper_property";
import { HostInfo } from "../../../host_info";
import { HostChangeOptions } from "../../../host_change_options";
import { RandomHostSelector } from "../../../random_host_selector";
import { Messages } from "../../../utils/messages";
import { equalsIgnoreCase, logAndThrowError } from "../../../utils/utils";

export class FastestResponseStrategyPlugin extends AbstractConnectionPlugin {
  static readonly FASTEST_RESPONSE_STRATEGY_NAME: string = "fastestResponse";
  private static readonly subscribedMethods = new Set<string>(["notifyHostListChanged", "acceptsStrategy", "getHostInfoByStrategy"]);
  protected static readonly cachedFastestResponseHostByRole: CacheMap<string, HostInfo> = new CacheMap<string, HostInfo>();
  protected cacheExpirationNanos: bigint;
  protected hostResponseTimeService: HostResponseTimeService;
  protected readonly properties: Map<string, any>;
  private pluginService: PluginService;
  private randomHostSelector: RandomHostSelector = new RandomHostSelector();

  constructor(pluginService: PluginService, properties: Map<string, any>, hostResponseTimeService?: HostResponseTimeService) {
    super();
    this.pluginService = pluginService;
    this.properties = properties;
    this.hostResponseTimeService =
      hostResponseTimeService ??
      new HostResponseTimeServiceImpl(pluginService, properties, WrapperProperties.RESPONSE_MEASUREMENT_INTERVAL_MILLIS.get(this.properties));
    this.cacheExpirationNanos = BigInt(WrapperProperties.RESPONSE_MEASUREMENT_INTERVAL_MILLIS.get(this.properties) * 1_000_000);
  }

  public getSubscribedMethods(): Set<string> {
    return FastestResponseStrategyPlugin.subscribedMethods;
  }

  async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    const result = await connectFunc();
    if (isInitialConnection) {
      this.hostResponseTimeService.setHosts(this.pluginService.getHosts());
    }
    return result;
  }

  async forceConnect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    const result = await forceConnectFunc();
    if (isInitialConnection) {
      this.hostResponseTimeService.setHosts(this.pluginService.getHosts());
    }
    return result;
  }

  acceptsStrategy(role: HostRole, strategy: string) {
    return equalsIgnoreCase(FastestResponseStrategyPlugin.FASTEST_RESPONSE_STRATEGY_NAME, strategy.toLowerCase());
  }

  getHostInfoByStrategy(role: HostRole, strategy: string, hosts?: HostInfo[]): HostInfo | undefined {
    if (!this.acceptsStrategy(role, strategy)) {
      logAndThrowError(Messages.get("FastestResponseStrategyPlugin.unsupportedHostSelectorStrategy", strategy));
    }
    // The cache holds a host with the fastest response time.
    // If the cache doesn't have a host for a role, it's necessary to find the fastest host in the topology.
    const fastestResponseHost: HostInfo = FastestResponseStrategyPlugin.cachedFastestResponseHostByRole.get(role);
    if (fastestResponseHost) {
      // Found the fastest host. Find the host in the latest topology.
      const foundHost = this.pluginService.getHosts().find((host) => host === fastestResponseHost);
      if (foundHost) {
        // Found a host in the topology.
        console.log("cached host");

        return foundHost;
      }
    }
    // Cached result isn't available. Need to find the fastest response time host.
    const calculatedFastestResponseHost: ResponseTimeTuple[] = this.pluginService
      .getHosts()
      .filter((host) => role === host.role)
      .map((host) => new ResponseTimeTuple(host, this.hostResponseTimeService.getResponseTime(host)))
      .sort((a, b) => {
        return a.responseTime - b.responseTime;
      });
    const calculatedHost = calculatedFastestResponseHost.length === 0 ? null : calculatedFastestResponseHost[0];

    if (!calculatedHost) {
      // Unable to identify the fastest response host.
      // As a last resort, let's use a random host selector.
      return this.randomHostSelector.getHost(hosts, role, this.properties);
    }
    FastestResponseStrategyPlugin.cachedFastestResponseHostByRole.put(role, calculatedHost.hostInfo, Number(this.cacheExpirationNanos));
    console.log("calculated host");
    return calculatedHost.hostInfo;
  }

  async notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): Promise<void> {
    this.hostResponseTimeService.setHosts(this.pluginService.getHosts());
  }
}

class ResponseTimeTuple {
  readonly hostInfo: HostInfo;
  readonly responseTime: number;

  constructor(hostInfo: HostInfo, responseTime: number) {
    this.hostInfo = hostInfo;
    this.responseTime = responseTime;
  }
}
