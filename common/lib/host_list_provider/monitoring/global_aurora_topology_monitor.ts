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
import { GdbTopologyUtils, GlobalTopologyUtils } from "../global_topology_utils";
import { FullServicesContainer } from "../../utils/full_services_container";
import { HostInfo } from "../../host_info";
import { ClientWrapper } from "../../client_wrapper";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { TopologyUtils } from "../topology_utils";

function isGdbTopologyUtils(utils: TopologyUtils): utils is TopologyUtils & GdbTopologyUtils {
  return "getRegion" in utils && typeof (utils as unknown as GdbTopologyUtils).getRegion === "function";
}

export class GlobalAuroraTopologyMonitor extends ClusterTopologyMonitorImpl {
  protected readonly instanceTemplatesByRegion: Map<string, HostInfo>;
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
  }

  protected override async getInstanceTemplate(hostId: string, targetClient: ClientWrapper): Promise<HostInfo> {
    if (!isGdbTopologyUtils(this.topologyUtils)) {
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
