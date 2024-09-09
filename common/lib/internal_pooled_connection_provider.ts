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

import { PluginService } from "./plugin_service";
import { WrapperProperties } from "./wrapper_property";
import { CanReleaseResources } from "./can_release_resources";
import { SlidingExpirationCache } from "./utils/sliding_expiration_cache";
import { PoolKey } from "./utils/pool_key";
import { PooledConnectionProvider } from "./pooled_connection_provider";
import { HostInfo } from "./host_info";
import { ClientWrapper } from "./client_wrapper";
import { HostRole } from "./host_role";
import { RdsUtils } from "./utils/rds_utils";
import { lookup, LookupAddress } from "dns";
import { promisify } from "util";
import { HostInfoBuilder } from "./host_info_builder";
import { RdsUrlType } from "./utils/rds_url_type";
import { AwsWrapperError } from "./utils/errors";
import { Messages } from "./utils/messages";
import { HostSelector } from "./host_selector";
import { RandomHostSelector } from "./random_host_selector";
import { InternalPoolMapping } from "./utils/internal_pool_mapping";
import { logger } from "../logutils";
import { RoundRobinHostSelector } from "./round_robin_host_selector";
import { AwsPoolClient } from "./aws_pool_client";
import { AwsPoolConfig } from "./aws_pool_config";

export class InternalPooledConnectionProvider implements PooledConnectionProvider, CanReleaseResources {
  private static readonly acceptedStrategies: Map<string, HostSelector> = new Map([
    [RandomHostSelector.STRATEGY_NAME, new RandomHostSelector()],
    [RoundRobinHostSelector.STRATEGY_NAME, new RoundRobinHostSelector()]
  ]);
  static readonly CACHE_CLEANUP_NANOS: bigint = BigInt(60_000_000_000); // 60 minutes
  static readonly POOL_EXPIRATION_NANOS: bigint = BigInt(30_000_000_000); // 30 minutes

  private readonly rdsUtil: RdsUtils = new RdsUtils();
  private readonly _poolMapping?: InternalPoolMapping;
  private readonly _poolConfig?: AwsPoolConfig;
  targetClient?: ClientWrapper;
  internalPool: AwsPoolClient | undefined;

  protected databasePools: SlidingExpirationCache<PoolKey, any> = new SlidingExpirationCache(
    InternalPooledConnectionProvider.CACHE_CLEANUP_NANOS,
    (pool: any) => pool.getIdleCount() === pool.getTotalCount(),
    (pool: any) => pool.end()
  );

  poolExpirationCheckNanos: bigint = InternalPooledConnectionProvider.POOL_EXPIRATION_NANOS; // 30 minutes

  constructor(poolConfig?: AwsPoolConfig);
  constructor(poolConfig?: AwsPoolConfig, mapping?: InternalPoolMapping);
  constructor(poolConfig?: AwsPoolConfig, mapping?: InternalPoolMapping, poolExpirationNanos?: bigint, poolCleanupNanos?: bigint) {
    this._poolMapping = mapping;
    this.poolExpirationCheckNanos = poolExpirationNanos ?? InternalPooledConnectionProvider.POOL_EXPIRATION_NANOS;
    this.databasePools.cleanupIntervalNs = poolCleanupNanos ?? InternalPooledConnectionProvider.CACHE_CLEANUP_NANOS;
    this._poolConfig = poolConfig ?? new AwsPoolConfig({});
  }

  acceptsStrategy(role: HostRole, strategy: string): boolean {
    return InternalPooledConnectionProvider.acceptedStrategies.has(strategy);
  }

  acceptsUrl(hostInfo: HostInfo, props: Map<string, any>): boolean {
    const urlType: RdsUrlType = this.rdsUtil.identifyRdsType(hostInfo.host);
    return RdsUrlType.RDS_INSTANCE === urlType;
  }

  async connect(hostInfo: HostInfo, pluginService: PluginService, props: Map<string, any>): Promise<ClientWrapper> {
    let connectionHostInfo: HostInfo = hostInfo;
    if (
      WrapperProperties.ENABLE_GREEN_HOST_REPLACEMENT.get(props) &&
      this.rdsUtil.isRdsDns(hostInfo.host) &&
      this.rdsUtil.isGreenInstance(hostInfo.host)
    ) {
      let resolvedAddress: LookupAddress | undefined = undefined;
      try {
        resolvedAddress = await this.lookupResult(hostInfo.host);
      } catch (err) {
        // do nothing
      }
      if (!resolvedAddress) {
        // Green instance DNS doesn't exist

        const fixedHost: string = this.rdsUtil.removeGreenInstancePrefix(hostInfo.host);
        connectionHostInfo = new HostInfoBuilder({
          hostAvailabilityStrategy: hostInfo.hostAvailabilityStrategy
        })
          .copyFrom(hostInfo)
          .withHost(fixedHost)
          .build();
      }
    }
    logger.debug("preparing dialect");

    const dialect = pluginService.getDialect();
    logger.debug("preparing pool propertiesss");
    const preparedConfig = dialect.preparePoolClientProperties(props, this._poolConfig);

    this.internalPool = this.databasePools.computeIfAbsent(
      new PoolKey(hostInfo.url, this.getPoolKey(hostInfo, props)),
      () => dialect.getAwsPoolClient(preparedConfig),
      this.poolExpirationCheckNanos
    );

    const poolClient = await this.getPoolConnection();

    return {
      client: poolClient,
      hostInfo: connectionHostInfo,
      properties: props
    };
  }

  async end(pluginService: PluginService, clientWrapper: ClientWrapper | undefined): Promise<void> {
    if (this.internalPool) {
      return this.internalPool.end(clientWrapper?.client);
    }
  }

  async getPoolConnection() {
    return this.internalPool!.connect();
  }

  public async releaseResources() {
    this.internalPool?.releaseResources();
    this.databasePools.clear();
  }

  getHostInfoByStrategy(hosts: HostInfo[], role: HostRole, strategy: string, props?: Map<string, any>): HostInfo {
    const acceptedStrategy = InternalPooledConnectionProvider.acceptedStrategies.get(strategy);
    if (!acceptedStrategy) {
      throw new AwsWrapperError(Messages.get("ConnectionProvider.unsupportedHostSelectorStrategy", strategy, "InternalPooledConnectionProvider"));
    }
    return acceptedStrategy.getHost(hosts, role, props);
  }

  protected lookupResult(host: string): Promise<LookupAddress> {
    return promisify(lookup)(host, {});
  }

  getHostUrlSet(): Set<string> {
    const hostUrls: Set<string> = new Set<string>();
    for (const [key, val] of this.databasePools.entries) {
      hostUrls.add(key.getUrl());
    }
    return hostUrls;
  }

  getHostCount() {
    return this.databasePools.size;
  }

  getKeySet(): Set<PoolKey> {
    return new Set<PoolKey>(this.databasePools.keys);
  }

  getPoolKey(hostInfo: HostInfo, props: Map<string, any>) {
    return this._poolMapping?.getKey(hostInfo, props) ?? WrapperProperties.USER.get(props);
  }

  logConnections() {
    const poolString: string = "";

    for (const [key, val] of this.databasePools.entries) {
      poolString.concat("\t[ ");
      poolString.concat(key.toString()).concat(":");
      poolString.concat("\n\t {");
      poolString.concat("\n\t\t").concat(val.toString());
      poolString.concat("\n\t }\n").concat("\t");
    }

    logger.debug("Internal Pooled Connection: \n[\n" + poolString + "\n]");
  }

  setDatabasePools(connectionPools: SlidingExpirationCache<PoolKey, any>): void {
    this.databasePools = connectionPools;
  }
}
