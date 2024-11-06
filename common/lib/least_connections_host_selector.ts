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

import { HostSelector } from "./host_selector";
import { HostInfo } from "./host_info";
import { HostRole } from "./host_role";
import { AwsWrapperError } from "./utils/errors";
import { HostAvailability } from "./host_availability/host_availability";
import { Messages } from "./utils/messages";
import { SlidingExpirationCache } from "./utils/sliding_expiration_cache";

export class LeastConnectionsHostSelector implements HostSelector {
  protected static databasePools: SlidingExpirationCache<string, any>;
  static readonly STRATEGY_NAME = "leastConnections";

  constructor(databasePools: SlidingExpirationCache<string, any>) {
    LeastConnectionsHostSelector.databasePools = databasePools;
  }

  getHost(hosts: HostInfo[], role: HostRole, props?: Map<string, any>): HostInfo {
    const eligibleHosts: HostInfo[] = hosts
      .filter((host: HostInfo) => host.role === role && host.availability === HostAvailability.AVAILABLE)
      .sort((hostA: HostInfo, hostB: HostInfo) => {
        const hostACount = this.getNumConnections(hostA, LeastConnectionsHostSelector.databasePools);
        const hostBCount = this.getNumConnections(hostB, LeastConnectionsHostSelector.databasePools);
        return hostACount < hostBCount ? -1 : hostACount > hostBCount ? 1 : 0;
      });

    if (eligibleHosts.length === 0) {
      throw new AwsWrapperError(Messages.get("HostSelector.noHostsMatchingRole", role));
    }
    return eligibleHosts[0];
  }

  getNumConnections(hostInfo: HostInfo, databasePools: SlidingExpirationCache<string, any>): number {
    let numConnections: number = 0;
    const url: string = hostInfo.url;
    for (const [key, val] of databasePools.map.entries()) {
      if (!key.includes(url)) {
        continue;
      }
      numConnections += val.item.getActiveCount();
    }
    return numConnections;
  }

  // for testing purposes only
  static setDatabasePools(connectionPools: SlidingExpirationCache<string, any>): void {
    LeastConnectionsHostSelector.databasePools = connectionPools;
  }
}
