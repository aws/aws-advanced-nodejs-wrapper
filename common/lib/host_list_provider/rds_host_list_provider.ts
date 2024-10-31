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

import { DynamicHostListProvider } from "./host_list_provider";
import { HostInfo } from "../host_info";
import { AwsClient } from "../aws_client";
import { HostRole } from "../host_role";
import { RdsUrlType } from "../utils/rds_url_type";
import { RdsUtils } from "../utils/rds_utils";
import { HostListProviderService } from "../host_list_provider_service";
import { ConnectionUrlParser } from "../utils/connection_url_parser";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";
import { WrapperProperties } from "../wrapper_property";
import { logger } from "../../logutils";
import { HostAvailability } from "../host_availability/host_availability";
import { CacheMap } from "../utils/cache_map";
import { logTopology } from "../utils/utils";
import { TopologyAwareDatabaseDialect } from "../topology_aware_database_dialect";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { ClientWrapper } from "../client_wrapper";

export class RdsHostListProvider implements DynamicHostListProvider {
  private readonly originalUrl: string;
  private readonly rdsHelper: RdsUtils;
  protected readonly properties: Map<string, any>;
  private rdsUrlType: RdsUrlType;
  private initialHostList: HostInfo[];
  private initialHost: HostInfo;
  private refreshRateNano: number;
  private suggestedClusterIdRefreshRateNano: number = 10 * 60 * 1_000_000_000; // 10 minutes
  private hostList?: HostInfo[];
  protected readonly connectionUrlParser: ConnectionUrlParser;
  protected readonly hostListProviderService: HostListProviderService;

  public static readonly suggestedPrimaryClusterIdCache: CacheMap<string, string> = new CacheMap<string, string>();

  public static readonly primaryClusterIdCache: CacheMap<string, boolean> = new CacheMap<string, boolean>();
  public static readonly topologyCache: CacheMap<string, HostInfo[]> = new CacheMap<string, HostInfo[]>();
  public clusterId: string = Date.now().toString();
  public isInitialized: boolean = false;
  public isPrimaryClusterId?: boolean;
  public clusterInstanceTemplate?: HostInfo;

  constructor(properties: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService) {
    this.rdsHelper = new RdsUtils();
    this.hostListProviderService = hostListProviderService;
    this.connectionUrlParser = hostListProviderService.getConnectionUrlParser();
    this.originalUrl = originalUrl;
    this.properties = properties;

    let port = WrapperProperties.PORT.get(properties);
    if (port != null) {
      port = hostListProviderService.getDialect().getDefaultPort();
    }

    this.initialHostList = this.connectionUrlParser.getHostsFromConnectionUrl(this.originalUrl, false, port, () =>
      this.hostListProviderService.getHostInfoBuilder()
    );
    if (!this.initialHostList || this.initialHostList.length === 0) {
      throw new AwsWrapperError(Messages.get("RdsHostListProvider.parsedListEmpty", this.originalUrl));
    }

    this.initialHost = this.initialHostList[0];
    this.hostListProviderService.setInitialConnectionHostInfo(this.initialHost);
    this.refreshRateNano = WrapperProperties.CLUSTER_TOPOLOGY_REFRESH_RATE_MS.get(this.properties) * 1000000;
    this.rdsUrlType = this.rdsHelper.identifyRdsType(this.initialHost.host);
  }

  init(): void {
    if (this.isInitialized) {
      return;
    }

    this.isPrimaryClusterId = false;

    const hostInfoBuilder = this.hostListProviderService.getHostInfoBuilder();

    this.clusterInstanceTemplate = hostInfoBuilder
      .withHost(WrapperProperties.CLUSTER_INSTANCE_HOST_PATTERN.get(this.properties) ?? this.rdsHelper.getRdsInstanceHostPattern(this.originalUrl))
      .withPort(WrapperProperties.PORT.get(this.properties))
      .build();

    this.validateHostPatternSetting(this.clusterInstanceTemplate.host);

    const clusterIdSetting: string = WrapperProperties.CLUSTER_ID.get(this.properties);
    if (clusterIdSetting) {
      this.clusterId = clusterIdSetting;
    } else if (this.rdsUrlType === RdsUrlType.RDS_PROXY) {
      // Each proxy is associated with a single cluster, so it's safe to use RDS Proxy Url as cluster
      // identification
      this.clusterId = this.initialHost.url;
    } else if (this.rdsUrlType.isRds) {
      const clusterSuggestedResult: ClusterSuggestedResult | null = this.getSuggestedClusterId(this.initialHost.host);
      if (clusterSuggestedResult && clusterSuggestedResult.clusterId) {
        this.clusterId = clusterSuggestedResult.clusterId;
        this.isPrimaryClusterId = clusterSuggestedResult.isPrimaryClusterId;
      } else {
        const clusterRdsHostUrl: string | null = this.rdsHelper.getRdsClusterHostUrl(this.initialHost.host);
        if (clusterRdsHostUrl) {
          this.clusterId = this.clusterInstanceTemplate.isPortSpecified()
            ? `${clusterRdsHostUrl}:${this.clusterInstanceTemplate.port}`
            : clusterRdsHostUrl;
          this.isPrimaryClusterId = true;
          RdsHostListProvider.primaryClusterIdCache.put(this.clusterId, true, this.suggestedClusterIdRefreshRateNano);
        }
      }
    }

    this.isInitialized = true;
  }

  async forceRefresh(): Promise<HostInfo[]>;
  async forceRefresh(targetClient: ClientWrapper): Promise<HostInfo[]>;
  async forceRefresh(targetClient?: ClientWrapper): Promise<HostInfo[]> {
    this.init();

    const currentClient = targetClient ?? this.hostListProviderService.getCurrentClient().targetClient;
    if (currentClient) {
      const results: FetchTopologyResult = await this.getTopology(currentClient, true);
      this.hostList = results.hosts;
      return Array.from(this.hostList);
    }
    throw new AwsWrapperError("Could not retrieve targetClient.");
  }

  async getHostRole(client: AwsClient, dialect: DatabaseDialect): Promise<HostRole> {
    if (!this.isTopologyAwareDatabaseDialect(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }

    if (client.targetClient) {
      return dialect.getHostRole(client.targetClient);
    } else {
      throw new AwsWrapperError(Messages.get("AwsClient targetClient not defined."));
    }
  }

  async identifyConnection(targetClient: ClientWrapper, dialect: DatabaseDialect): Promise<HostInfo | null> {
    if (!this.isTopologyAwareDatabaseDialect(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }
    const instanceName = await dialect.identifyConnection(targetClient);

    return this.refresh(targetClient).then((topology) => {
      const matches = topology.filter((host) => host.hostId === instanceName);
      return matches.length === 0 ? null : matches[0];
    });
  }

  async refresh(): Promise<HostInfo[]>;
  async refresh(targetClient: ClientWrapper): Promise<HostInfo[]>;
  async refresh(targetClient?: ClientWrapper): Promise<HostInfo[]> {
    this.init();

    const currentClient = targetClient ?? this.hostListProviderService.getCurrentClient().targetClient;
    const results: FetchTopologyResult = await this.getTopology(currentClient, false);
    logger.debug(logTopology(results.hosts, results.isCachedData ? "[From cache] " : ""));
    this.hostList = results.hosts;
    return this.hostList;
  }

  async getTopology(targetClient: ClientWrapper | undefined, forceUpdate: boolean): Promise<FetchTopologyResult> {
    this.init();

    if (!this.clusterId) {
      throw new AwsWrapperError("no cluster id");
    }

    const suggestedPrimaryClusterId: string | null = RdsHostListProvider.suggestedPrimaryClusterIdCache.get(this.clusterId);
    if (suggestedPrimaryClusterId && this.clusterId !== suggestedPrimaryClusterId) {
      this.clusterId = suggestedPrimaryClusterId;
      this.isPrimaryClusterId = true;
    }

    const cachedHosts: HostInfo[] | null = RdsHostListProvider.topologyCache.get(this.clusterId);

    // This clusterId is a primary one and is about to create a new entry in the cache.
    // When a primary entry is created it needs to be suggested for other (non-primary) entries.
    // Remember a flag to do suggestion after cache is updated.
    const needToSuggest: boolean = !cachedHosts && this.isPrimaryClusterId === true;
    if (!cachedHosts || forceUpdate) {
      // need to re-fetch the topology.
      if (!targetClient || !(await this.hostListProviderService.isClientValid(targetClient))) {
        return new FetchTopologyResult(false, this.initialHostList);
      }

      const hosts = await this.queryForTopology(targetClient, this.hostListProviderService.getDialect());
      if (hosts && hosts.length > 0) {
        RdsHostListProvider.topologyCache.put(this.clusterId, hosts, this.refreshRateNano);
        if (needToSuggest) {
          this.suggestPrimaryCluster(hosts);
        }
        return new FetchTopologyResult(false, hosts);
      }
    }

    if (!cachedHosts) {
      return new FetchTopologyResult(false, this.initialHostList);
    } else {
      return new FetchTopologyResult(true, cachedHosts);
    }
  }

  private getSuggestedClusterId(host: string): ClusterSuggestedResult | null {
    for (const [key, hosts] of RdsHostListProvider.topologyCache.getEntries()) {
      const isPrimaryCluster: boolean = RdsHostListProvider.primaryClusterIdCache.get(key, false, this.suggestedClusterIdRefreshRateNano) ?? false;
      if (key === host) {
        return new ClusterSuggestedResult(host, isPrimaryCluster);
      }

      if (hosts) {
        for (const hostInfo of hosts) {
          if (hostInfo.host === host) {
            logger.debug(Messages.get("RdsHostListProvider.suggestedClusterId", key, host));
            return new ClusterSuggestedResult(key, isPrimaryCluster);
          }
        }
      }
    }
    return null;
  }

  suggestPrimaryCluster(primaryClusterHosts: HostInfo[]): void {
    if (!primaryClusterHosts) {
      return;
    }

    const primaryClusterHostUrls: Set<string> = new Set<string>();
    primaryClusterHosts.forEach((hostInfo) => {
      primaryClusterHostUrls.add(hostInfo.url);
    });

    for (const [clusterId, clusterHosts] of RdsHostListProvider.topologyCache.getEntries()) {
      const isPrimaryCluster: boolean | null = RdsHostListProvider.primaryClusterIdCache.get(
        clusterId,
        false,
        this.suggestedClusterIdRefreshRateNano
      );
      const suggestedPrimaryClusterId: string | null = RdsHostListProvider.suggestedPrimaryClusterIdCache.get(clusterId);
      if (isPrimaryCluster || suggestedPrimaryClusterId || !clusterHosts) {
        continue;
      }

      for (const clusterHost of clusterHosts) {
        if (primaryClusterHostUrls.has(clusterHost.url)) {
          RdsHostListProvider.suggestedPrimaryClusterIdCache.put(clusterId, this.clusterId, this.suggestedClusterIdRefreshRateNano);
          break;
        }
      }
    }
  }

  protected isTopologyAwareDatabaseDialect(arg: any): arg is TopologyAwareDatabaseDialect {
    return arg;
  }

  async queryForTopology(targetClient: ClientWrapper, dialect: DatabaseDialect): Promise<HostInfo[]> {
    if (!this.isTopologyAwareDatabaseDialect(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }

    return await dialect.queryForTopology(targetClient, this).then((res: any) => this.processQueryResults(res));
  }

  private async processQueryResults(result: HostInfo[]): Promise<HostInfo[]> {
    const hostMap: Map<string, HostInfo> = new Map<string, HostInfo>();

    let hosts: HostInfo[] = [];
    const writers: HostInfo[] = [];
    result.forEach((host) => {
      hostMap.set(host.host, host);
    });

    hostMap.forEach((host) => {
      if (host.role !== HostRole.WRITER) {
        hosts.push(host);
      } else {
        writers.push(host);
      }
    });

    const writerCount: number = writers.length;
    if (writerCount === 0) {
      hosts = [];
    } else if (writers[0]) {
      hosts.push(writers[0]);
    } else {
      const sortedWriters: HostInfo[] = writers.sort((a, b) => {
        return a.lastUpdateTime - b.lastUpdateTime;
      });

      hosts.push(sortedWriters[0]);
    }

    return hosts;
  }

  createHost(host: string, isWriter: boolean, weight: number, lastUpdateTime: number, port?: number): HostInfo {
    host = !host ? "?" : host;
    const endpoint: string | null = this.getHostEndpoint(host);
    if (!port) {
      port = this.clusterInstanceTemplate?.isPortSpecified() ? this.clusterInstanceTemplate?.port : this.initialHost?.port;
    }

    return this.hostListProviderService
      .getHostInfoBuilder()
      .withHost(endpoint ?? "")
      .withPort(port ?? -1)
      .withRole(isWriter ? HostRole.WRITER : HostRole.READER)
      .withAvailability(HostAvailability.AVAILABLE)
      .withWeight(weight)
      .withLastUpdateTime(lastUpdateTime)
      .withHostId(host)
      .build();
  }

  private getHostEndpoint(hostName: string): string | null {
    if (!this.clusterInstanceTemplate || !this.clusterInstanceTemplate.host) {
      return null;
    }
    const host = this.clusterInstanceTemplate.host;
    return host.replace("?", hostName);
  }

  getCachedTopology(): HostInfo[] | null {
    if (!this.clusterId) {
      return null;
    }
    return RdsHostListProvider.topologyCache.get(this.clusterId) ?? null;
  }

  static clearAll(): void {
    RdsHostListProvider.topologyCache.clear();
    RdsHostListProvider.primaryClusterIdCache.clear();
    RdsHostListProvider.suggestedPrimaryClusterIdCache.clear();
  }

  clear(): void {
    if (this.clusterId) {
      RdsHostListProvider.topologyCache.delete(this.clusterId);
    }
  }

  private validateHostPatternSetting(hostPattern: string) {
    if (!this.rdsHelper.isDnsPatternValid(hostPattern)) {
      const message: string = Messages.get("RdsHostListProvider.invalidPattern.suggestedClusterId");
      logger.error(message);
      throw new AwsWrapperError(message);
    }

    const rdsUrlType: RdsUrlType = this.rdsHelper.identifyRdsType(hostPattern);
    if (rdsUrlType == RdsUrlType.RDS_PROXY) {
      const message: string = Messages.get("RdsHostListProvider.clusterInstanceHostPatternNotSupportedForRDSProxy");
      logger.error(message);
      throw new AwsWrapperError(message);
    }

    if (rdsUrlType == RdsUrlType.RDS_CUSTOM_CLUSTER) {
      const message: string = Messages.get("RdsHostListProvider.clusterInstanceHostPatternNotSupportedForRdsCustom");
      logger.error(message);
      throw new AwsWrapperError(message);
    }
  }

  getRdsUrlType(): RdsUrlType {
    return this.rdsUrlType;
  }

  getHostProviderType(): string {
    return this.constructor.name;
  }
}

export class FetchTopologyResult {
  hosts: HostInfo[];
  isCachedData: boolean;

  constructor(isCachedData: boolean, hosts: HostInfo[]) {
    this.hosts = hosts;
    this.isCachedData = isCachedData;
  }
}

class ClusterSuggestedResult {
  clusterId: string;
  isPrimaryClusterId: boolean;

  constructor(clusterId: string, isPrimaryClusterId: boolean) {
    this.clusterId = clusterId;
    this.isPrimaryClusterId = isPrimaryClusterId;
  }
}
