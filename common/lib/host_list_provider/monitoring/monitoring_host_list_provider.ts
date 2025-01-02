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

import { RdsHostListProvider } from "../rds_host_list_provider";
import { HostInfo } from "../../host_info";
import { SlidingExpirationCache } from "../../utils/sliding_expiration_cache";
import { ClusterTopologyMonitor, ClusterTopologyMonitorImpl } from "./cluster_topology_monitor";
import { PluginService } from "../../plugin_service";
import { HostListProviderService } from "../../host_list_provider_service";
import { ClientWrapper } from "../../client_wrapper";
import { DatabaseDialect } from "../../database_dialect/database_dialect";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { WrapperProperties } from "../../wrapper_property";
import { BlockingHostListProvider } from "../host_list_provider";

export class MonitoringRdsHostListProvider extends RdsHostListProvider implements BlockingHostListProvider {
  static readonly CACHE_CLEANUP_NANOS: bigint = BigInt(60_000_000_000); // 1 minute.
  static readonly MONITOR_EXPIRATION_NANOS: bigint = BigInt(15 * 60_000_000_000); // 15 minutes.
  static readonly DEFAULT_TOPOLOGY_QUERY_TIMEOUT_MS = 5000; // 5 seconds.

  private static monitors: SlidingExpirationCache<string, ClusterTopologyMonitor> = new SlidingExpirationCache(
    MonitoringRdsHostListProvider.CACHE_CLEANUP_NANOS,
    () => true,
    async (monitor: ClusterTopologyMonitor) => {
      try {
        await monitor.close();
      } catch {
        // Ignore.
      }
    }
  );

  private readonly pluginService: PluginService;

  constructor(properties: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService, pluginService: PluginService) {
    super(properties, originalUrl, hostListProviderService);
    this.pluginService = pluginService;
  }

  async clearAll(): Promise<void> {
    RdsHostListProvider.clearAll();
    // TODO: refactor when sliding-expiration-cache refactoring is merged.
    for (const [key, monitor] of MonitoringRdsHostListProvider.monitors.entries) {
      if (monitor !== undefined) {
        await monitor.item.close();
      }
    }
    MonitoringRdsHostListProvider.monitors.clear();
  }

  async queryForTopology(targetClient: ClientWrapper, dialect: DatabaseDialect): Promise<HostInfo[]> {
    let monitor: ClusterTopologyMonitor = MonitoringRdsHostListProvider.monitors.get(
      this.clusterId,
      MonitoringRdsHostListProvider.MONITOR_EXPIRATION_NANOS
    );
    if (!monitor) {
      monitor = this.initMonitor();
    }

    try {
      return await monitor.forceRefresh(targetClient, MonitoringRdsHostListProvider.DEFAULT_TOPOLOGY_QUERY_TIMEOUT_MS);
    } catch {
      return null;
    }
  }

  async sqlQueryForTopology(targetClient: ClientWrapper): Promise<HostInfo[]> {
    const dialect: DatabaseDialect = this.hostListProviderService.getDialect();
    if (!this.isTopologyAwareDatabaseDialect(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }
    return await dialect.queryForTopology(targetClient, this).then((res: any) => this.processQueryResults(res));
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]> {
    let monitor: ClusterTopologyMonitor = MonitoringRdsHostListProvider.monitors.get(
      this.clusterId,
      MonitoringRdsHostListProvider.MONITOR_EXPIRATION_NANOS
    );
    if (!monitor) {
      monitor = this.initMonitor();
    }

    if (!monitor) {
      throw new AwsWrapperError(Messages.get("MonitoringHostListProvider.requiresMonitor"));
    }
    return await monitor.forceMonitoringRefresh(shouldVerifyWriter, timeoutMs);
  }

  protected initMonitor(): ClusterTopologyMonitor {
    const monitor = new ClusterTopologyMonitorImpl(
      this.clusterId,
      MonitoringRdsHostListProvider.topologyCache,
      this.initialHost,
      this.properties,
      this.pluginService,
      this,
      WrapperProperties.CLUSTER_TOPOLOGY_REFRESH_RATE_MS.get(this.properties),
      WrapperProperties.CLUSTER_TOPOLOGY_HIGH_REFRESH_RATE_MS.get(this.properties)
    );

    return MonitoringRdsHostListProvider.monitors.computeIfAbsent(
      this.clusterId,
      (x) => monitor,
      MonitoringRdsHostListProvider.MONITOR_EXPIRATION_NANOS
    );
  }
}
