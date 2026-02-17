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
import { HostRole } from "../host_role";
import { RdsUrlType } from "../utils/rds_url_type";
import { RdsUtils } from "../utils/rds_utils";
import { HostListProviderService } from "../host_list_provider_service";
import { ConnectionUrlParser } from "../utils/connection_url_parser";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";
import { WrapperProperties } from "../wrapper_property";
import { logger } from "../../logutils";
import { isDialectTopologyAware, logTopology } from "../utils/utils";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { ClientWrapper } from "../client_wrapper";
import { CoreServicesContainer } from "../utils/core_services_container";
import { StorageService } from "../utils/storage/storage_service";
import { Topology } from "./topology";
import { TopologyUtils } from "./topology_utils";

export class RdsHostListProvider implements DynamicHostListProvider {
  private readonly originalUrl: string;
  private readonly rdsHelper: RdsUtils;
  private readonly storageService: StorageService;
  protected readonly topologyUtils: TopologyUtils;
  protected readonly properties: Map<string, any>;
  private rdsUrlType: RdsUrlType;
  private initialHostList: HostInfo[];
  protected initialHost: HostInfo;
  private refreshRateNano: number;
  private hostList?: HostInfo[];
  protected readonly connectionUrlParser: ConnectionUrlParser;
  protected readonly hostListProviderService: HostListProviderService;

  public clusterId: string = Date.now().toString();
  public isInitialized: boolean = false;
  public clusterInstanceTemplate?: HostInfo;

  constructor(properties: Map<string, any>, originalUrl: string, topologyUtils: TopologyUtils, hostListProviderService: HostListProviderService) {
    this.rdsHelper = new RdsUtils();
    this.topologyUtils = topologyUtils;
    this.hostListProviderService = hostListProviderService;
    this.connectionUrlParser = hostListProviderService.getConnectionUrlParser();
    this.originalUrl = originalUrl;
    this.properties = properties;
    this.storageService = CoreServicesContainer.getInstance().getStorageService(); // TODO: store the service container instead.

    let port = WrapperProperties.PORT.get(properties);
    if (port == null) {
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

    const hostInfoBuilder = this.hostListProviderService.getHostInfoBuilder();

    this.clusterInstanceTemplate = hostInfoBuilder
      .withHost(WrapperProperties.CLUSTER_INSTANCE_HOST_PATTERN.get(this.properties) ?? this.rdsHelper.getRdsInstanceHostPattern(this.originalUrl))
      .withPort(WrapperProperties.PORT.get(this.properties))
      .build();

    this.validateHostPatternSetting(this.clusterInstanceTemplate.host);

    this.clusterId = WrapperProperties.CLUSTER_ID.get(this.properties);

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

  async getHostRole(client: ClientWrapper, dialect: DatabaseDialect): Promise<HostRole> {
    if (!isDialectTopologyAware(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }

    if (client) {
      return await dialect.getHostRole(client);
    } else {
      throw new AwsWrapperError(Messages.get("AwsClient.targetClientNotDefined"));
    }
  }

  async getWriterId(client: ClientWrapper): Promise<string | null> {
    const dialect = this.hostListProviderService.getDialect();
    if (!isDialectTopologyAware(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }

    if (client) {
      return await dialect.getWriterId(client);
    }

    throw new AwsWrapperError(Messages.get("AwsClient.targetClientNotDefined"));
  }

  async identifyConnection(targetClient: ClientWrapper): Promise<HostInfo | null> {
    const instanceIds: [string, string] = await this.topologyUtils.getInstanceId(targetClient);
    if (!instanceIds || instanceIds.some((id) => !id)) {
      return null;
    }

    let topology = await this.refresh(targetClient);
    let isForcedRefresh = false;

    if (!topology) {
      topology = await this.forceRefresh();
      isForcedRefresh = true;
    }

    if (!topology) {
      return null;
    }

    const instanceName = instanceIds[1];
    let matches = topology.filter((host) => host.hostId === instanceName);
    const foundHost = matches.length === 0 ? null : matches[0];

    if (!foundHost && !isForcedRefresh) {
      topology = await this.forceRefresh();
      if (!topology) {
        return null;
      }
    }

    matches = topology.filter((host) => host.hostId === instanceName);
    return matches.length === 0 ? null : matches[0];
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
      throw new AwsWrapperError(Messages.get("RdsHostListProvider.noClusterId"));
    }

    const cachedHosts: HostInfo[] | null = this.getStoredTopology();

    // This clusterId is a primary one and is about to create a new entry in the cache.
    // When a primary entry is created it needs to be suggested for other (non-primary) entries.
    // Remember a flag to do suggestion after cache is updated.
    if (!cachedHosts || forceUpdate) {
      // need to re-fetch the topology.
      if (!targetClient || !(await this.hostListProviderService.isClientValid(targetClient))) {
        return new FetchTopologyResult(false, this.initialHostList);
      }

      const hosts = await this.getCurrentTopology(targetClient, this.hostListProviderService.getDialect());
      if (hosts && hosts.length > 0) {
        this.storageService.set(this.clusterId, new Topology(hosts));
        return new FetchTopologyResult(false, hosts);
      }
    }

    if (!cachedHosts) {
      return new FetchTopologyResult(false, this.initialHostList);
    } else {
      return new FetchTopologyResult(true, cachedHosts);
    }
  }

  async getCurrentTopology(targetClient: ClientWrapper, dialect: DatabaseDialect): Promise<HostInfo[]> {
    return await this.topologyUtils.queryForTopology(targetClient, dialect, this.initialHost, this.clusterInstanceTemplate);
  }

  private getHostEndpoint(hostName: string): string | null {
    if (!this.clusterInstanceTemplate || !this.clusterInstanceTemplate.host) {
      return null;
    }
    const host = this.clusterInstanceTemplate.host;
    return host.replace("?", hostName);
  }

  getStoredTopology(): HostInfo[] | null {
    if (!this.clusterId) {
      return null;
    }

    const topology: Topology = this.storageService.get(Topology, this.clusterId);

    return topology == null ? null : topology.hosts;
  }

  static clearAll(): void {
    // No-op
    // TODO: remove if still not used after full service container refactoring
  }

  clear(): void {
    if (this.clusterId) {
      CoreServicesContainer.getInstance().getStorageService().remove(Topology, this.clusterId);
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

  getClusterId(): string {
    this.init();
    return this.clusterId;
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
