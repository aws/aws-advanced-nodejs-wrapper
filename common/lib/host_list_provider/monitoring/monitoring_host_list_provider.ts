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
import { ClusterTopologyMonitor, ClusterTopologyMonitorImpl } from "./cluster_topology_monitor";
import { PluginService } from "../../plugin_service";
import { HostListProviderService } from "../../host_list_provider_service";
import { ClientWrapper } from "../../client_wrapper";
import { DatabaseDialect } from "../../database_dialect/database_dialect";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { WrapperProperties } from "../../wrapper_property";
import { BlockingHostListProvider } from "../host_list_provider";
import { logger } from "../../../logutils";
import { SlidingExpirationCacheWithCleanupTask } from "../../utils/sliding_expiration_cache_with_cleanup_task";
import { isDialectTopologyAware } from "../../utils/utils";

export class MonitoringRdsHostListProvider extends RdsHostListProvider implements BlockingHostListProvider {
  static readonly CACHE_CLEANUP_NANOS: bigint = BigInt(60_000_000_000); // 1 minute.
  static readonly MONITOR_EXPIRATION_NANOS: bigint = BigInt(15 * 60_000_000_000); // 15 minutes.
  static readonly DEFAULT_TOPOLOGY_QUERY_TIMEOUT_MS = 5000; // 5 seconds.

  private static monitors: SlidingExpirationCacheWithCleanupTask<string, ClusterTopologyMonitor> = new SlidingExpirationCacheWithCleanupTask(
    MonitoringRdsHostListProvider.CACHE_CLEANUP_NANOS,
    () => true,
    async (item: ClusterTopologyMonitor) => {
      try {
        await item.close();
      } catch {
        // Ignore.
      }
    },
    "MonitoringRdsHostListProvider.monitors"
  );

  private readonly pluginService: PluginService;

  constructor(properties: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService, pluginService: PluginService) {
    super(properties, originalUrl, hostListProviderService);
    this.pluginService = pluginService;
  }

  async clearAllMonitors(): Promise<void> {
    RdsHostListProvider.clearAll();
    await MonitoringRdsHostListProvider.monitors.clear();
  }

  async queryForTopology(targetClient: ClientWrapper, dialect: DatabaseDialect): Promise<HostInfo[]> {
    const monitor: ClusterTopologyMonitor = this.initMonitor();

    try {
      return await monitor.forceRefresh(targetClient, MonitoringRdsHostListProvider.DEFAULT_TOPOLOGY_QUERY_TIMEOUT_MS);
    } catch (error) {
      logger.info(Messages.get("MonitoringHostListProvider.errorForceRefresh", error.message));
      return null;
    }
  }

  async sqlQueryForTopology(targetClient: ClientWrapper): Promise<HostInfo[]> {
    const dialect: DatabaseDialect = this.hostListProviderService.getDialect();
    if (!isDialectTopologyAware(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }
    return await dialect.queryForTopology(targetClient, this).then((res: any) => this.processQueryResults(res));
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]> {
    const monitor: ClusterTopologyMonitor = this.initMonitor();

    return await monitor.forceMonitoringRefresh(shouldVerifyWriter, timeoutMs);
  }

  protected initMonitor(): ClusterTopologyMonitor {
    const monitor: ClusterTopologyMonitor = MonitoringRdsHostListProvider.monitors.computeIfAbsent(
      this.clusterId,
      () =>
        new ClusterTopologyMonitorImpl(
          this.clusterId,
          MonitoringRdsHostListProvider.topologyCache,
          this.initialHost,
          this.properties,
          this.pluginService,
          this,
          WrapperProperties.CLUSTER_TOPOLOGY_REFRESH_RATE_MS.get(this.properties),
          WrapperProperties.CLUSTER_TOPOLOGY_HIGH_REFRESH_RATE_MS.get(this.properties)
        ),
      MonitoringRdsHostListProvider.MONITOR_EXPIRATION_NANOS
    );

    if (monitor === null) {
      throw new AwsWrapperError(Messages.get("MonitoringHostListProvider.requiresMonitor"));
    }
    return monitor;
  }
}
