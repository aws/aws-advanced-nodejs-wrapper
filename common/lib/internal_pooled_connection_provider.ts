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
import { RoundRobinHostSelector } from "./round_robin_host_selector";
import { AwsInternalPoolClient } from "./aws_pool_client";
import { AwsPoolConfig } from "./aws_pool_config";
import { LeastConnectionsHostSelector } from "./least_connections_host_selector";
import { PoolClientWrapper } from "./pool_client_wrapper";
import { logger } from "../logutils";
import { SlidingExpirationCacheWithCleanupTask } from "./utils/sliding_expiration_cache_with_cleanup_task";

export class InternalPooledConnectionProvider implements PooledConnectionProvider, CanReleaseResources {
  static readonly CACHE_CLEANUP_NANOS: bigint = BigInt(10 * 60_000_000_000); // 10 minutes
  static readonly POOL_EXPIRATION_NANOS: bigint = BigInt(30 * 60_000_000_000); // 30 minutes
  protected static databasePools: SlidingExpirationCacheWithCleanupTask<string, any> = new SlidingExpirationCacheWithCleanupTask(
    InternalPooledConnectionProvider.CACHE_CLEANUP_NANOS,
    (pool: any) => pool.getActiveCount() === 0,
    async (pool: any) => await pool.end(),
    "InternalPooledConnectionProvider.databasePools"
  );

  private static readonly acceptedStrategies: Map<string, HostSelector> = new Map([
    [RandomHostSelector.STRATEGY_NAME, new RandomHostSelector()],
    [RoundRobinHostSelector.STRATEGY_NAME, new RoundRobinHostSelector()],
    [LeastConnectionsHostSelector.STRATEGY_NAME, new LeastConnectionsHostSelector(InternalPooledConnectionProvider.databasePools)]
  ]);
  private readonly rdsUtil: RdsUtils = new RdsUtils();
  private readonly _poolMapping?: InternalPoolMapping;
  private readonly _poolConfig?: AwsPoolConfig;
  targetClient?: ClientWrapper;
  internalPool: AwsInternalPoolClient | undefined;

  private static poolExpirationCheckNanos: bigint = InternalPooledConnectionProvider.POOL_EXPIRATION_NANOS; // 30 minutes

  constructor(poolConfig?: AwsPoolConfig, mapping?: InternalPoolMapping, poolExpirationNanos?: bigint, poolCleanupNanos?: bigint) {
    this._poolMapping = mapping;
    InternalPooledConnectionProvider.poolExpirationCheckNanos = poolExpirationNanos ?? InternalPooledConnectionProvider.POOL_EXPIRATION_NANOS;
    InternalPooledConnectionProvider.databasePools.cleanupIntervalNs = poolCleanupNanos ?? InternalPooledConnectionProvider.CACHE_CLEANUP_NANOS;
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
    const resultProps = new Map(props);
    resultProps.set(WrapperProperties.HOST.name, hostInfo.host);
    if (hostInfo.isPortSpecified()) {
      resultProps.set(WrapperProperties.PORT.name, hostInfo.port);
    }

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
        resultProps.set(WrapperProperties.HOST.name, fixedHost);
        connectionHostInfo = new HostInfoBuilder({
          hostAvailabilityStrategy: hostInfo.hostAvailabilityStrategy
        })
          .copyFrom(hostInfo)
          .withHost(fixedHost)
          .build();
      }
    }

    const dialect = pluginService.getDriverDialect();
    const preparedConfig = dialect.preparePoolClientProperties(resultProps, this._poolConfig);
    this.internalPool = InternalPooledConnectionProvider.databasePools.computeIfAbsent(
      new PoolKey(connectionHostInfo.url, this.getPoolKey(connectionHostInfo, resultProps)).getPoolKeyString(),
      () => dialect.getAwsPoolClient(preparedConfig),
      InternalPooledConnectionProvider.poolExpirationCheckNanos
    );

    const poolClient = await this.getPoolConnection(connectionHostInfo, props);
    pluginService.attachErrorListener(poolClient);
    return poolClient;
  }

  async getPoolConnection(hostInfo: HostInfo, props: Map<string, string>) {
    return new PoolClientWrapper(await this.internalPool!.connect(), hostInfo, props);
  }

  async releaseResources() {
    if (this.internalPool) {
      try {
        await this.internalPool.releaseResources();
      } catch (error) {
        // ignore
      }
    }
    await InternalPooledConnectionProvider.databasePools.clear();
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

  async containsHost(host: string): Promise<boolean> {
    try {
      const resolvedAddress = await this.lookupResult(host);
      return !!resolvedAddress;
    } catch (err) {
      return false;
    }
  }

  getHostCount() {
    return InternalPooledConnectionProvider.databasePools.size;
  }

  getKeySet(): Set<string> {
    return new Set<string>(InternalPooledConnectionProvider.databasePools.keys);
  }

  getPoolKey(hostInfo: HostInfo, props: Map<string, any>) {
    return this._poolMapping?.getPoolKey(hostInfo, props) ?? WrapperProperties.USER.get(props);
  }

  logConnections() {
    if (InternalPooledConnectionProvider.databasePools.size === 0) {
      return;
    }

    const connections = Array.from(InternalPooledConnectionProvider.databasePools.entries).map(([v, k]) => [v, k.item.constructor.name]);
    logger.debug(`Internal Pooled Connections: [\r\n${connections.join("\r\n")}\r\n]`);
  }

  // for testing only
  setDatabasePools(connectionPools: SlidingExpirationCacheWithCleanupTask<string, any>): void {
    InternalPooledConnectionProvider.databasePools = connectionPools;
    LeastConnectionsHostSelector.setDatabasePools(connectionPools);
  }
}
