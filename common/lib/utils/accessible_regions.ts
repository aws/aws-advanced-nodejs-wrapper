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

import { WrapperProperties } from "../wrapper_property";
import { HostInfo } from "../host_info";
import { RdsUtils } from "./rds_utils";

export class AccessibleRegions {
  private static readonly rdsUtils = new RdsUtils();

  static parse(props: Map<string, any>): string[] | null {
    const value = WrapperProperties.GLOBAL_DB_ACCESSIBLE_REGIONS.get(props);
    if (!value || value.trim().length === 0) {
      return null;
    }

    const regions = value
      .split(",")
      .map((r: string) => r.trim().toLowerCase())
      .filter((r: string) => r.length > 0);

    return regions.length > 0 ? regions : null;
  }

  /**
   * Returns whether the given host resides in one of the accessible regions. When no accessible
   * regions are configured (null or empty), every host is considered accessible.
   *
   * `accessibleRegions` is expected to be lowercased (as produced by {@link parse}).
   */
  static isHostAccessible(host: HostInfo, accessibleRegions: string[] | null): boolean {
    if (!accessibleRegions || accessibleRegions.length === 0) {
      return true;
    }
    const region = AccessibleRegions.rdsUtils.getRdsRegion(host.host);
    return region !== null && accessibleRegions.includes(region.toLowerCase());
  }

  /**
   * Filters the given hosts down to those reachable from the configured accessible regions.
   * When no accessible regions are configured (null or empty), the list is returned unchanged.
   *
   * `accessibleRegions` is expected to be lowercased (as produced by {@link parse}).
   */
  static filterHosts(hosts: HostInfo[], accessibleRegions: string[] | null): HostInfo[] {
    if (!accessibleRegions || accessibleRegions.length === 0) {
      return hosts;
    }
    return hosts.filter((host) => AccessibleRegions.isHostAccessible(host, accessibleRegions));
  }
}
