/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { TopologyQueryResult, TopologyUtils } from "./topology_utils";
import { ClientWrapper } from "../client_wrapper";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { HostInfo } from "../host_info";
import { isDialectTopologyAware } from "../utils/utils";
import { Messages } from "../utils/messages";
import { AwsWrapperError } from "../utils/errors";

export class GlobalTopologyUtils extends TopologyUtils {
  async queryForTopology(
    targetClient: ClientWrapper,
    dialect: DatabaseDialect,
    initialHost: HostInfo,
    clusterInstanceTemplate: HostInfo
  ): Promise<HostInfo[]> {
    throw new AwsWrapperError("Not implemented");
  }

  async queryForTopologyWithRegion(
    targetClient: ClientWrapper,
    dialect: DatabaseDialect,
    initialHost: HostInfo,
    instanceTemplateByRegion: Map<string, HostInfo>
  ): Promise<HostInfo[]> {
    if (!isDialectTopologyAware(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }

    return await dialect
      .queryForTopology(targetClient)
      .then((res: TopologyQueryResult[]) => this.verifyWriter(this.createHostsWithTemplateMap(res, initialHost, instanceTemplateByRegion)));
  }

  private createHostsWithTemplateMap(
    topologyQueryResults: TopologyQueryResult[],
    initialHost: HostInfo,
    instanceTemplateByRegion: Map<string, HostInfo>
  ): HostInfo[] {
    const hostsMap = new Map<string, HostInfo>();
    topologyQueryResults.forEach((row) => {
      if (!row.awsRegion) {
        throw new AwsWrapperError(Messages.get("GlobalTopologyUtils.missingRegion", row.host));
      }
      const clusterInstanceTemplate = instanceTemplateByRegion.get(row.awsRegion);

      if (!clusterInstanceTemplate) {
        throw new AwsWrapperError(Messages.get("GlobalTopologyUtils.missingTemplateForRegion", row.awsRegion, row.host));
      }

      const lastUpdateTime = row.lastUpdateTime ?? Date.now();

      const host = this.createHost(
        row.id,
        row.host,
        row.isWriter,
        row.weight,
        lastUpdateTime,
        initialHost,
        clusterInstanceTemplate,
        row.endpoint,
        row.port
      );

      const existing = hostsMap.get(host.host);
      if (!existing || existing.lastUpdateTime < host.lastUpdateTime) {
        hostsMap.set(host.host, host);
      }
    });

    return Array.from(hostsMap.values());
  }
}
