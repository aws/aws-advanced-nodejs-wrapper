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

import { ClientWrapper } from "../client_wrapper";
import { HostInfo } from "../host_info";
import { PluginService } from "../plugin_service";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { TopologyAwareDatabaseDialect } from "../database_dialect/topology_aware_database_dialect";
import { RdsUtils } from "./rds_utils";
import { RdsUrlType } from "./rds_url_type";
import { AwsWrapperError } from "./errors";
import { Messages } from "./messages";

/**
 * Tuple of (instanceId, instanceName) identifying a connection's underlying instance, as
 * returned by a topology-aware dialect. Either value may be null when identification fails.
 */
export type InstanceIdAndName = [instanceId: string | null, instanceName: string | null];

/**
 * Identifies the underlying instance a connection is established to.
 *
 * For static endpoints (IP addresses or custom domain names) the identification result is cached,
 * keyed by the connection's host name, to avoid repeatedly querying the database.
 */
export interface HostIdCacheService {
  /**
   * Identify the connected host, using the cache where possible.
   *
   * @param targetClient the connection to be identified.
   * @param connectionHostInfo the {@link HostInfo} the connection was established with.
   * @param pluginService the plugin service instance.
   * @returns the identified {@link HostInfo}, or null if it cannot be determined.
   */
  identifyConnection(targetClient: ClientWrapper, connectionHostInfo: HostInfo, pluginService: PluginService): Promise<HostInfo | null>;
}

function isTopologyAwareDialect(dialect: DatabaseDialect): dialect is DatabaseDialect & TopologyAwareDatabaseDialect {
  return typeof (dialect as Partial<TopologyAwareDatabaseDialect>).getInstanceId === "function";
}

export class HostIdCacheServiceImpl implements HostIdCacheService {
  static readonly PROP_ENABLED = "AWS_NODEJS_HOST_CACHE_ENABLED";
  static readonly PROP_REGEXP = "AWS_NODEJS_HOST_CACHE_REGEXP";

  private static readonly cache = new Map<string, InstanceIdAndName>();
  private static readonly isEnabled = (process.env[HostIdCacheServiceImpl.PROP_ENABLED] ?? "true").toLowerCase() === "true";
  private static readonly hostRegexp = new RegExp(process.env[HostIdCacheServiceImpl.PROP_REGEXP] ?? ".*");
  private static readonly rdsHelper = new RdsUtils();

  async identifyConnection(targetClient: ClientWrapper, connectionHostInfo: HostInfo, pluginService: PluginService): Promise<HostInfo | null> {
    if (!targetClient || !connectionHostInfo || !pluginService) {
      return null;
    }

    const urlType: RdsUrlType = HostIdCacheServiceImpl.rdsHelper.identifyRdsType(connectionHostInfo.host);
    switch (urlType) {
      case RdsUrlType.RDS_INSTANCE:
        return connectionHostInfo;
      case RdsUrlType.IP_ADDRESS:
      case RdsUrlType.OTHER:
        // It might be a custom domain name. Cache the identification keyed by host name when allowed.
        if (HostIdCacheServiceImpl.isEnabled && HostIdCacheServiceImpl.hostRegexp.test(connectionHostInfo.host)) {
          return this.getCachedHostInfo(targetClient, connectionHostInfo, pluginService);
        }
        return pluginService.identifyConnection(targetClient);
      default:
        // Other hosts are dynamic and may change at any time, so they can't be cached.
        return pluginService.identifyConnection(targetClient);
    }
  }

  protected async getCachedHostInfo(
    targetClient: ClientWrapper,
    connectionHostInfo: HostInfo,
    pluginService: PluginService
  ): Promise<HostInfo | null> {
    const host = connectionHostInfo.host;

    let instanceIdAndName = HostIdCacheServiceImpl.cache.get(host);
    if (!instanceIdAndName) {
      instanceIdAndName = await this.queryInstanceIdAndName(targetClient, pluginService);
      HostIdCacheServiceImpl.cache.set(host, instanceIdAndName);
    }

    const [instanceId, instanceName] = instanceIdAndName;
    if (!instanceId && !instanceName) {
      // We've already tried to identify the connection, but got nothing.
      return null;
    }

    let topology = pluginService.getAllHosts();
    if (!topology || topology.length === 0) {
      const provider = pluginService.getHostListProvider();
      topology = provider ? await provider.forceRefresh() : null;
      if (!topology || topology.length === 0) {
        return null;
      }
    }

    return topology.find((candidate) => instanceId === candidate.hostId || instanceName === candidate.host) ?? null;
  }

  private async queryInstanceIdAndName(targetClient: ClientWrapper, pluginService: PluginService): Promise<InstanceIdAndName> {
    const dialect = pluginService.getDialect();
    if (!isTopologyAwareDialect(dialect)) {
      return [null, null];
    }

    try {
      const [instanceId, instanceName] = await dialect.getInstanceId(targetClient);
      return [instanceId ?? null, instanceName ?? null];
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("HostIdCacheService.errorIdentifyConnection"), error);
    }
  }

  /**
   * Clears the static host identification cache. Intended for test cleanup.
   */
  static clearCache(): void {
    HostIdCacheServiceImpl.cache.clear();
  }
}
