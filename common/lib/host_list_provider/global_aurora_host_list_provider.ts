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

import { RdsHostListProvider } from "./rds_host_list_provider";
import { FullServicesContainer } from "../utils/full_services_container";
import { HostInfo } from "../host_info";
import { WrapperProperties } from "../wrapper_property";
import { ClusterTopologyMonitor, ClusterTopologyMonitorImpl } from "./monitoring/cluster_topology_monitor";
import { GlobalAuroraTopologyMonitor } from "./monitoring/global_aurora_topology_monitor";
import { MonitorInitializer } from "../utils/monitoring/monitor";
import { ClientWrapper } from "../client_wrapper";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { parseInstanceTemplates } from "../utils/utils";

export class GlobalAuroraHostListProvider extends RdsHostListProvider {
  protected instanceTemplatesByRegion: Map<string, HostInfo>;
  protected override initSettings(): void {
    super.initSettings();

    const instanceTemplates = WrapperProperties.GLOBAL_CLUSTER_INSTANCE_HOST_PATTERNS.get(this.properties);
    this.instanceTemplatesByRegion = parseInstanceTemplates(
      instanceTemplates,
      (hostPattern: string) => this.validateHostPatternSetting(hostPattern),
      () => this.hostListProviderService.getHostInfoBuilder()
    );
  }

  protected override async getOrCreateMonitor(): Promise<ClusterTopologyMonitor> {
    const initializer: MonitorInitializer = {
      createMonitor: (servicesContainer: FullServicesContainer): ClusterTopologyMonitor => {
        return new GlobalAuroraTopologyMonitor(
          servicesContainer,
          this.topologyUtils,
          this.clusterId,
          this.initialHost,
          this.properties,
          this.clusterInstanceTemplate,
          this.refreshRateNano,
          this.highRefreshRateNano,
          this.instanceTemplatesByRegion
        );
      }
    };

    return await this.servicesContainers
      .getMonitorService()
      .runIfAbsent(ClusterTopologyMonitorImpl, this.clusterId, this.servicesContainers, this.properties, initializer);
  }

  override async getCurrentTopology(targetClient: ClientWrapper, dialect: DatabaseDialect): Promise<HostInfo[]> {
    this.init();
    return await this.topologyUtils.queryForTopology(targetClient, dialect, this.initialHost, this.instanceTemplatesByRegion);
  }
}
