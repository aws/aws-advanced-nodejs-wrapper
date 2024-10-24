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
import { WrapperProperties, WrapperProperty } from "./wrapper_property";
import { AwsWrapperError } from "./utils/errors";
import { CacheMap } from "./utils/cache_map";
import { HostAvailability } from "./host_availability/host_availability";
import { isInteger } from "lodash";
import { Messages } from "./utils/messages";
import { SlidingExpirationCache } from "./utils/sliding_expiration_cache";
import { PoolKey } from "./utils/pool_key";

export class LeastConnectionsHostSelector implements HostSelector {
  protected databasePools: SlidingExpirationCache<PoolKey, any>;
  static STRATEGY_NAME = "leastConnections";

  constructor(databasePools: SlidingExpirationCache<PoolKey, any>) {
    this.databasePools = databasePools;
  }

  getHost(hosts: HostInfo[], role: HostRole, props?: Map<string, any>): HostInfo {
    const eligibleHosts: HostInfo[] = hosts
      .filter((host: HostInfo) => host.role === role && host.availability === HostAvailability.AVAILABLE)
      .sort((hostA: HostInfo, hostB: HostInfo) => {
        const hostACount = this.getNumConnections(hostA, this.databasePools);
        const hostBCount = this.getNumConnections(hostB, this.databasePools);
        return hostACount < hostBCount ? -1 : hostACount > hostBCount ? 1 : 0;
      });

    if (eligibleHosts.length === 0) {
      throw new AwsWrapperError(Messages.get("HostSelector.noHostsMatchingRole", role));
    }
    return eligibleHosts[0];
  }

  getNumConnections(hostInfo: HostInfo, databasePools: SlidingExpirationCache<PoolKey, any>): number {
    let numConnections: number = 0;
    const url: string = hostInfo.url;
    for (const [key, val] of databasePools.map.entries()) {
      if (url !== key.url) {
        continue;
      }
      numConnections = numConnections + val.item.getTotalCount() - val.item.getIdleCount();
    }
    return numConnections;
  }

  setDatabasePools(connectionPools: SlidingExpirationCache<PoolKey, any>): void {
    this.databasePools = connectionPools;
  }
}
