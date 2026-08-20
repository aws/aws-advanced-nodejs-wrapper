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

import { ClusterTopologyMonitorImpl } from "./cluster_topology_monitor";
import { GlobalDbTopologyUtils } from "../global_topology_utils";
import { FullServicesContainer } from "../../utils/full_services_container";
import { HostInfo } from "../../host_info";
import { ClientWrapper } from "../../client_wrapper";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { TopologyUtils } from "../topology_utils";
import { AccessibleRegions } from "../../utils/accessible_regions";
import { MonitoringConnectionHandler } from "./monitoring_connection_handler";
import { GlobalDbMonitoringConnectionHandler } from "./global_db_monitoring_connection_handler";
import { WrapperProperties } from "../../wrapper_property";
import { RdsUtils } from "../../utils/rds_utils";
import { logger } from "../../../logutils";

function isGlobalDbTopologyUtils(utils: TopologyUtils): utils is TopologyUtils & GlobalDbTopologyUtils {
  return "getRegion" in utils && typeof (utils as unknown as GlobalDbTopologyUtils).getRegion === "function";
}

export class GlobalAuroraTopologyMonitor extends ClusterTopologyMonitorImpl {
  protected readonly instanceTemplatesByRegion: Map<string, HostInfo>;
  protected readonly accessibleRegions: string[] | null;
  protected readonly globalDbRdsUtils: RdsUtils = new RdsUtils();
  declare public readonly topologyUtils: TopologyUtils;

  constructor(
    servicesContainer: FullServicesContainer,
    topologyUtils: TopologyUtils,
    clusterId: string,
    initialHostInfo: HostInfo,
    properties: Map<string, any>,
    instanceTemplate: HostInfo,
    refreshRateNano: number,
    highRefreshRateNano: number,
    instanceTemplatesByRegion: Map<string, HostInfo>
  ) {
    super(servicesContainer, topologyUtils, clusterId, initialHostInfo, properties, instanceTemplate, refreshRateNano, highRefreshRateNano);

    this.instanceTemplatesByRegion = instanceTemplatesByRegion;
    this.topologyUtils = topologyUtils;
    this.accessibleRegions = AccessibleRegions.parse(properties);

    if (this.accessibleRegions) {
      logger.debug(Messages.get("GlobalAuroraTopologyMonitor.accessibleRegions", this.accessibleRegions.join(",")));
    }
  }

  protected override createConnectionHandler(): MonitoringConnectionHandler {
    const homeRegion =
      WrapperProperties.FAILOVER_HOME_REGION.get(this.monitoringProperties) ?? this.globalDbRdsUtils.getRdsRegion(this.initialHostInfo.host);
    return new GlobalDbMonitoringConnectionHandler(
      this.pluginService,
      this.monitoringProperties,
      this.accessibleRegions,
      homeRegion,
      () => this.monitoringClient,
      (client) => {
        this.monitoringClient = client;
      }
    );
  }

  protected override filterHostsForHostMonitoring(hosts: HostInfo[]): HostInfo[] {
    return AccessibleRegions.filterHosts(hosts, this.accessibleRegions);
  }

  protected override async openAnyClientAndUpdateTopology(): Promise<HostInfo[] | null> {
    if (this.accessibleRegions) {
      // Only fail loud when the initial host's region is known and excluded. If the region can't be
      // determined, defer to the normal workflow rather than blocking the connection.
      const region = this.globalDbRdsUtils.getRdsRegion(this.initialHostInfo.host);
      if (region && !this.accessibleRegions.includes(region.toLowerCase())) {
        const msg = Messages.get("GlobalAuroraTopologyMonitor.initialHostNotInAccessibleRegion", this.initialHostInfo.host, region);
        throw new AwsWrapperError(msg);
      }
    }

    return super.openAnyClientAndUpdateTopology();
  }

  /**
   * A Global Database needs one instance template per region: hosts in each region are built from
   * that region's endpoint suffix. The inherited implementation passes the single
   * `instanceTemplate`, which for a Global Database endpoint resolves to the global endpoint's
   * suffix and cannot address any instance.
   */
  override queryForTopology(client: ClientWrapper): Promise<HostInfo[]> {
    return this.topologyUtils.queryForTopology(client, this.pluginService.getDialect(), this.initialHostInfo, this.instanceTemplatesByRegion);
  }

  protected override async getInstanceTemplate(hostId: string, targetClient: ClientWrapper): Promise<HostInfo> {
    if (!isGlobalDbTopologyUtils(this.topologyUtils)) {
      throw new AwsWrapperError(Messages.get("GlobalAuroraTopologyMonitor.invalidTopologyUtils"));
    }

    const dialect = this.hostListProviderService.getDialect();
    const region = await this.topologyUtils.getRegion(hostId, targetClient, dialect);

    if (region) {
      const instanceTemplate = this.instanceTemplatesByRegion.get(region);
      if (!instanceTemplate) {
        throw new AwsWrapperError(Messages.get("GlobalAuroraTopologyMonitor.cannotFindRegionTemplate", region));
      }
      return instanceTemplate;
    }

    return this.instanceTemplate;
  }
}
