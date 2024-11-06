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
import { Messages } from "./utils/messages";

import pkgLodash from "lodash";
const { isInteger } = pkgLodash;

export class RoundRobinHostSelector implements HostSelector {
  static DEFAULT_ROUND_ROBIN_CACHE_EXPIRE_NANO = 10 * 60_000_000_000; // 10 minutes
  static DEFAULT_WEIGHT = 1;
  static STRATEGY_NAME = "roundRobin";
  static roundRobinCache = new CacheMap<string, RoundRobinClusterInfo>();

  getHost(hosts: HostInfo[], role: HostRole, props?: Map<string, any>): HostInfo {
    const eligibleHosts: HostInfo[] = hosts
      .filter((host: HostInfo) => host.role === role && host.availability === HostAvailability.AVAILABLE)
      .sort((hostA: HostInfo, hostB: HostInfo) => {
        const hostAHostName = hostA.host.toLowerCase();
        const hostBHostName = hostB.host.toLowerCase();
        return hostAHostName < hostBHostName ? -1 : hostAHostName > hostBHostName ? 1 : 0;
      });

    if (eligibleHosts.length === 0) {
      throw new AwsWrapperError(Messages.get("HostSelector.noHostsMatchingRole", role));
    }

    // Create new cache entries for provided hosts if necessary. All hosts point to the same cluster info.
    this.createCacheEntryForHosts(eligibleHosts, props);
    const currentClusterInfoKey = eligibleHosts[0].host;
    const clusterInfo = RoundRobinHostSelector.roundRobinCache.get(currentClusterInfoKey);

    if (!clusterInfo) {
      throw new AwsWrapperError(Messages.get("HostSelector.roundRobinMissingClusterInfo", currentClusterInfoKey));
    }

    const lastHost = clusterInfo.lastHost;
    let lastHostIndex = -1;

    // Check if lastHost is in list of eligible hosts. Update lastHostIndex.
    if (lastHost) {
      lastHostIndex = eligibleHosts.findIndex((host: HostInfo) => host.host === lastHost.host);
    }

    let targetHostIndex: number;
    // If the host is weighted and the lastHost is in the eligibleHosts list.
    if (clusterInfo.weightCounter > 0 && lastHostIndex !== -1) {
      targetHostIndex = lastHostIndex;
    } else {
      if (lastHostIndex !== eligibleHosts.length - 1) {
        targetHostIndex = lastHostIndex + 1;
      } else {
        targetHostIndex = 0;
      }

      const weight = clusterInfo.clusterWeightsMap.get(eligibleHosts[targetHostIndex].hostId);

      clusterInfo.weightCounter = weight ?? clusterInfo.defaultWeight;
    }

    clusterInfo.weightCounter--;
    clusterInfo.lastHost = eligibleHosts[targetHostIndex];

    return eligibleHosts[targetHostIndex];
  }

  static setRoundRobinHostWeightPairsProperty(hosts: HostInfo[], props: Map<string, any>) {
    let roundRobinHostWeightPairsString = "";
    for (let i = 0; i < hosts.length; i++) {
      roundRobinHostWeightPairsString += `${hosts[i].host}:${hosts[i].weight}`;
      if (i < hosts.length - 1) {
        roundRobinHostWeightPairsString += ",";
      }
    }

    props.set(WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.name, roundRobinHostWeightPairsString);
  }

  private createCacheEntryForHosts(hosts: HostInfo[], props?: Map<string, any>) {
    const hostsWithCacheEntry: HostInfo[] = [];
    hosts.forEach((host) => {
      if (RoundRobinHostSelector.roundRobinCache.get(host.host)) {
        hostsWithCacheEntry.push(host);
      }
    });

    // If there is a host with an existing entry, update the cache entries for all hosts to point each to the same
    // RoundRobinClusterInfo object. If there are no cache entries, create a new RoundRobinClusterInfo.
    if (hostsWithCacheEntry.length > 0) {
      const roundRobinClusterInfo = RoundRobinHostSelector.roundRobinCache.get(hostsWithCacheEntry[0].host);
      if (
        roundRobinClusterInfo &&
        this.hasPropertyChanged(roundRobinClusterInfo.lastClusterHostWeightPairPropertyValue, WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS, props)
      ) {
        roundRobinClusterInfo.lastHost = null;
        roundRobinClusterInfo.weightCounter = 0;
        this.updateCachedHostWeightPairsPropertiesForRoundRobinClusterInfo(roundRobinClusterInfo, props);
      }

      if (
        roundRobinClusterInfo &&
        roundRobinClusterInfo.lastClusterDefaultWeightPropertyValue &&
        this.hasPropertyChanged(roundRobinClusterInfo.lastClusterDefaultWeightPropertyValue, WrapperProperties.ROUND_ROBIN_DEFAULT_WEIGHT, props)
      ) {
        roundRobinClusterInfo.defaultWeight = 1;
        this.updateCachedDefaultWeightPropertiesForRoundRobinClusterInfo(roundRobinClusterInfo, props);
      }

      hosts.forEach((host) => {
        RoundRobinHostSelector.roundRobinCache.put(host.host, roundRobinClusterInfo!, RoundRobinHostSelector.DEFAULT_ROUND_ROBIN_CACHE_EXPIRE_NANO);
      });
    } else {
      const roundRobinClusterInfo = new RoundRobinClusterInfo();
      this.updateCachePropertiesForRoundRobinClusterInfo(roundRobinClusterInfo, props);
      hosts.forEach((host) => {
        RoundRobinHostSelector.roundRobinCache.put(host.host, roundRobinClusterInfo, RoundRobinHostSelector.DEFAULT_ROUND_ROBIN_CACHE_EXPIRE_NANO);
      });
    }
  }

  private hasPropertyChanged(lastPropertyValue: string | number, wrapperProperty: WrapperProperty<any>, props?: Map<string, any>): boolean {
    if (!props || wrapperProperty.get(props) === undefined || wrapperProperty.get(props) === null) {
      return false;
    }
    const propValue = wrapperProperty.get(props);
    return propValue !== lastPropertyValue;
  }

  private updateCachePropertiesForRoundRobinClusterInfo(roundRobinClusterInfo: RoundRobinClusterInfo, props?: Map<string, any>) {
    this.updateCachedDefaultWeightPropertiesForRoundRobinClusterInfo(roundRobinClusterInfo, props);
    this.updateCachedHostWeightPairsPropertiesForRoundRobinClusterInfo(roundRobinClusterInfo, props);
  }

  private updateCachedDefaultWeightPropertiesForRoundRobinClusterInfo(roundRobinClusterInfo: RoundRobinClusterInfo, props?: Map<string, any>) {
    let defaultWeight = RoundRobinHostSelector.DEFAULT_WEIGHT;
    if (props) {
      defaultWeight = WrapperProperties.ROUND_ROBIN_DEFAULT_WEIGHT.get(props);
      if (!Number.isInteger(defaultWeight) || defaultWeight < RoundRobinHostSelector.DEFAULT_WEIGHT) {
        throw new AwsWrapperError(Messages.get("HostSelector.roundRobinInvalidDefaultWeight"));
      }
      roundRobinClusterInfo.lastClusterDefaultWeightPropertyValue = defaultWeight;
    }

    roundRobinClusterInfo.defaultWeight = defaultWeight;
  }

  private updateCachedHostWeightPairsPropertiesForRoundRobinClusterInfo(roundRobinClusterInfo: RoundRobinClusterInfo, props?: Map<string, any>) {
    if (props) {
      const hostWeights = WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.get(props);
      if (hostWeights) {
        const hostWeightPairs = hostWeights.split(",");
        hostWeightPairs.forEach((hostWeightPair) => {
          const pair = hostWeightPair.split(":");
          if (!pair || pair.length === 0 || pair.length !== 2) {
            throw new AwsWrapperError(Messages.get("HostSelector.roundRobinInvalidHostWeightPairs"));
          }

          const hostName = pair[0].trim();
          const hostWeight = pair[1].trim();

          if (!hostName || !hostWeight) {
            throw new AwsWrapperError(Messages.get("HostSelector.roundRobinInvalidHostWeightPairs"));
          }

          const weight = Number(hostWeight);
          if (isNaN(weight) || !Number.isInteger(weight) || weight < RoundRobinHostSelector.DEFAULT_WEIGHT) {
            throw new AwsWrapperError(Messages.get("HostSelector.roundRobinInvalidHostWeightPairs"));
          }
          roundRobinClusterInfo.clusterWeightsMap.set(hostName, weight);
        });

        roundRobinClusterInfo.lastClusterHostWeightPairPropertyValue = WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.get(props);
      } else if (!hostWeights) {
        roundRobinClusterInfo.clusterWeightsMap.clear();
        roundRobinClusterInfo.lastClusterHostWeightPairPropertyValue = WrapperProperties.ROUND_ROBIN_HOST_WEIGHT_PAIRS.get(props);
      }
    }
  }

  // For testing purposes only
  clearCache() {
    RoundRobinHostSelector.roundRobinCache.clear();
  }
}

class RoundRobinClusterInfo {
  lastHost: HostInfo | null = null;
  clusterWeightsMap: Map<string, number> = new Map();
  defaultWeight: number = 1;
  weightCounter: number = 0;
  lastClusterHostWeightPairPropertyValue: string = "";
  lastClusterDefaultWeightPropertyValue: number | null = null;
}
