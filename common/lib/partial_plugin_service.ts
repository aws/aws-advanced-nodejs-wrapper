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
import { HostInfo } from "./host_info";
import { AwsClient } from "./aws_client";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { DatabaseDialect } from "./database_dialect/database_dialect";
import { HostInfoBuilder } from "./host_info_builder";
import { AwsTimeoutError, AwsWrapperError, UnsupportedMethodError } from "./";
import { HostAvailability } from "./host_availability/host_availability";
import { HostAvailabilityCacheItem } from "./host_availability/host_availability_cache_item";
import { HostChangeOptions } from "./host_change_options";
import { HostRole } from "./host_role";
import { SessionStateService } from "./session_state_service";
import { HostAvailabilityStrategyFactory } from "./host_availability/host_availability_strategy_factory";
import { ClientWrapper } from "./client_wrapper";
import { logger } from "../logutils";
import { Messages } from "./utils/messages";
import { getWriter, logTopology } from "./utils/utils";
import { TelemetryFactory } from "./utils/telemetry/telemetry_factory";
import { DriverDialect } from "./driver_dialect/driver_dialect";
import { AllowedAndBlockedHosts } from "./allowed_and_blocked_hosts";
import { ConnectionPlugin } from "./connection_plugin";
import { FullServicesContainer } from "./utils/full_services_container";
import { HostListProviderService } from "./host_list_provider_service";
import { StorageService } from "./utils/storage/storage_service";
import { CoreServicesContainer } from "./utils/core_services_container";

/**
 * A PluginService containing some methods that are not intended to be called. This class is intended to be used
 * by monitors, which require a PluginService, but are not expected to need or use some of the methods defined
 * by the PluginService interface. The methods that are not expected to be called will throw an
 * UnsupportedOperationException when called.
 */
export class PartialPluginService implements PluginService, HostListProviderService {
  private static readonly DEFAULT_TOPOLOGY_QUERY_TIMEOUT_MS = 5000; // 5 seconds

  protected readonly servicesContainer: FullServicesContainer;
  protected readonly storageService: StorageService;
  protected readonly props: Map<string, any>;
  protected hostListProvider: HostListProvider | null = null;
  protected hosts: HostInfo[] = [];
  protected currentHostInfo: HostInfo | null = null;
  protected initialConnectionHostInfo: HostInfo | null = null;
  protected isInTransactionFlag: boolean = false;
  protected readonly dialect: DatabaseDialect;
  protected readonly driverDialect: DriverDialect;
  protected allowedAndBlockedHosts: AllowedAndBlockedHosts | null = null;
  private _isPooledClient: boolean = false;
  private connectionUrlParser: ConnectionUrlParser;

  constructor(
    servicesContainer: FullServicesContainer,
    props: Map<string, any>,
    dialect: DatabaseDialect,
    driverDialect: DriverDialect,
    connectionUrlParser: ConnectionUrlParser
  ) {
    this.servicesContainer = servicesContainer;
    this.storageService = servicesContainer.storageService;
    this.servicesContainer.hostListProviderService = this;
    this.servicesContainer.pluginService = this;

    this.props = props;
    this.dialect = dialect;
    this.driverDialect = driverDialect;
    this.connectionUrlParser = connectionUrlParser;

    this.hostListProvider = this.dialect.getHostListProvider(this.props, this.props.get("host"), this.servicesContainer);
  }

  getCurrentClient(): AwsClient {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "getCurrentClient"));
  }

  getCurrentHostInfo(): HostInfo | null {
    if (!this.currentHostInfo) {
      this.currentHostInfo = this.initialConnectionHostInfo;

      if (!this.currentHostInfo) {
        if (this.getAllHosts().length === 0) {
          throw new AwsWrapperError(Messages.get("PluginService.hostListEmpty"));
        }

        const writerHost = getWriter(this.getAllHosts());
        if (writerHost) {
          this.currentHostInfo = writerHost;
          const allowedHosts = this.getHosts();
          if (!allowedHosts.some((hostInfo: HostInfo) => hostInfo.host === writerHost.host && hostInfo.port === writerHost.port)) {
            throw new AwsWrapperError(
              Messages.get(
                "PluginService.currentHostNotAllowed",
                this.currentHostInfo ? this.currentHostInfo.host : "<null>",
                logTopology(allowedHosts, "")
              )
            );
          }
        }

        if (!this.currentHostInfo) {
          const hosts = this.getHosts();
          if (hosts.length > 0) {
            this.currentHostInfo = hosts[0];
          }
        }
      }

      if (!this.currentHostInfo) {
        throw new AwsWrapperError(Messages.get("PluginService.currentHostNotDefined"));
      }

      logger.debug(`Set current host to: ${this.currentHostInfo.host}`);
    }

    return this.currentHostInfo;
  }

  setCurrentHostInfo(value: HostInfo): void {
    this.currentHostInfo = value;
  }

  setInitialConnectionHostInfo(initialConnectionHostInfo: HostInfo): void {
    this.initialConnectionHostInfo = initialConnectionHostInfo;
  }

  getInitialConnectionHostInfo(): HostInfo | null {
    return this.initialConnectionHostInfo;
  }

  acceptsStrategy(role: HostRole, strategy: string): boolean {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "acceptsStrategy"));
  }

  getHostInfoByStrategy(role: HostRole, strategy: string, hosts?: HostInfo[]): HostInfo | undefined {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "getHostInfoByStrategy"));
  }

  getHostRole(client: any): Promise<HostRole> | undefined {
    return this.dialect.getHostRole(client);
  }

  getDriverDialect(): DriverDialect {
    return this.driverDialect;
  }

  getConnectionUrlParser(): ConnectionUrlParser {
    return this.connectionUrlParser;
  }

  setCurrentClient(newClient: ClientWrapper, hostInfo: HostInfo): Promise<Set<HostChangeOptions>> {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "setCurrentClient"));
  }

  protected compare(hostInfoA: HostInfo, hostInfoB: HostInfo): Set<HostChangeOptions> {
    const changes: Set<HostChangeOptions> = new Set<HostChangeOptions>();

    if (hostInfoA.host !== hostInfoB.host || hostInfoA.port !== hostInfoB.port) {
      changes.add(HostChangeOptions.HOSTNAME);
    }

    if (hostInfoA.role !== hostInfoB.role) {
      if (hostInfoB.role === HostRole.WRITER) {
        changes.add(HostChangeOptions.PROMOTED_TO_WRITER);
      } else if (hostInfoB.role === HostRole.READER) {
        changes.add(HostChangeOptions.PROMOTED_TO_READER);
      }
    }

    if (hostInfoA.availability !== hostInfoB.availability) {
      if (hostInfoB.availability === HostAvailability.AVAILABLE) {
        changes.add(HostChangeOptions.WENT_UP);
      } else if (hostInfoB.availability === HostAvailability.NOT_AVAILABLE) {
        changes.add(HostChangeOptions.WENT_DOWN);
      }
    }

    if (changes.size > 0) {
      changes.add(HostChangeOptions.HOST_CHANGED);
    }

    return changes;
  }

  getAllHosts(): HostInfo[] {
    return this.hosts;
  }

  getHosts(): HostInfo[] {
    const hostPermissions = this.allowedAndBlockedHosts;
    if (!hostPermissions) {
      return this.hosts;
    }

    let hosts = this.hosts;
    const allowedHostIds = hostPermissions.getAllowedHostIds();
    const blockedHostIds = hostPermissions.getBlockedHostIds();

    if (allowedHostIds && allowedHostIds.size > 0) {
      hosts = hosts.filter((host: HostInfo) => allowedHostIds.has(host.hostId));
    }

    if (blockedHostIds && blockedHostIds.size > 0) {
      hosts = hosts.filter((host: HostInfo) => !blockedHostIds.has(host.hostId));
    }

    return hosts;
  }

  setAvailability(hostAliases: Set<string>, availability: HostAvailability): void {
    if (hostAliases.size === 0) {
      return;
    }

    const hostsToChange = [
      ...new Set(
        this.getAllHosts().filter(
          (host: HostInfo) => hostAliases.has(host.asAlias) || [...host.aliases].some((hostAlias: string) => hostAliases.has(hostAlias))
        )
      )
    ];

    if (hostsToChange.length === 0) {
      return;
    }

    const changes = new Map<string, Set<HostChangeOptions>>();
    for (const host of hostsToChange) {
      const currentAvailability = host.getAvailability();
      host.availability = availability;
      this.storageService.set(host.url, new HostAvailabilityCacheItem(availability));
      if (currentAvailability !== availability) {
        let hostChanges: Set<HostChangeOptions>;
        if (availability === HostAvailability.AVAILABLE) {
          hostChanges = new Set([HostChangeOptions.WENT_UP, HostChangeOptions.HOST_CHANGED]);
        } else {
          hostChanges = new Set([HostChangeOptions.WENT_DOWN, HostChangeOptions.HOST_CHANGED]);
        }
        changes.set(host.url, hostChanges);
      }
    }

    if (changes.size > 0) {
      this.servicesContainer.pluginManager?.notifyHostListChanged(changes);
    }
  }

  isInTransaction(): boolean {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "isInTransaction"));
  }

  isDialectConfirmed(): boolean {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "isDialectConfirmed"));
  }

  setInTransaction(inTransaction: boolean): void {
    this.isInTransactionFlag = inTransaction;
  }

  getHostListProvider(): HostListProvider | null {
    return this.hostListProvider;
  }

  async refreshHostList(): Promise<void> {
    const updatedHostList = await this.getHostListProvider()?.refresh();
    if (updatedHostList && updatedHostList !== this.hosts) {
      this.updateHostAvailability(updatedHostList);
      this.setHostList(this.hosts, updatedHostList);
    }
  }

  async forceRefreshHostList(): Promise<void> {
    await this.forceMonitoringRefresh(false, PartialPluginService.DEFAULT_TOPOLOGY_QUERY_TIMEOUT_MS);
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<boolean> {
    const hostListProvider = this.getHostListProvider();

    if (!this.isDynamicHostListProvider()) {
      const providerName = hostListProvider?.constructor.name ?? "null";
      throw new UnsupportedMethodError(Messages.get("PluginService.requiredDynamicHostListProvider", providerName));
    }

    try {
      const updatedHostList = await (hostListProvider as any).forceMonitoringRefresh(shouldVerifyWriter, timeoutMs);
      if (updatedHostList) {
        this.updateHostAvailability(updatedHostList);
        this.setHostList(this.hosts, updatedHostList);
        return true;
      }
    } catch (err) {
      if (err instanceof AwsTimeoutError) {
        logger.debug(Messages.get("PluginService.forceMonitoringRefreshTimeout", timeoutMs.toString()));
      }
    }

    return false;
  }

  protected setHostList(oldHosts: HostInfo[] | null, newHosts: HostInfo[] | null): void {
    const oldHostMap: Map<string, HostInfo> = oldHosts ? new Map(oldHosts.map((e) => [e.url, e])) : new Map();

    const newHostMap: Map<string, HostInfo> = newHosts ? new Map(newHosts.map((e) => [e.url, e])) : new Map();

    const changes: Map<string, Set<HostChangeOptions>> = new Map();

    oldHostMap.forEach((value, key) => {
      const correspondingNewHost = newHostMap.get(key);
      if (!correspondingNewHost) {
        changes.set(key, new Set([HostChangeOptions.HOST_DELETED]));
      } else {
        const hostChanges = this.compare(value, correspondingNewHost);
        if (hostChanges.size > 0) {
          changes.set(key, hostChanges);
        }
      }
    });

    newHostMap.forEach((value, key) => {
      if (!oldHostMap.has(key)) {
        changes.set(key, new Set([HostChangeOptions.HOST_ADDED]));
      }
    });

    if (changes.size > 0) {
      this.hosts = newHosts ? newHosts : [];
      this.servicesContainer.pluginManager?.notifyHostListChanged(changes);
    }
  }

  isDynamicHostListProvider(): boolean {
    const provider = this.getHostListProvider();
    return provider !== null && typeof (provider as any).forceMonitoringRefresh === "function";
  }

  setHostListProvider(hostListProvider: HostListProvider): void {
    this.hostListProvider = hostListProvider;
  }

  connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper>;
  connect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip: ConnectionPlugin | null): Promise<ClientWrapper>;
  connect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip?: ConnectionPlugin | null): Promise<ClientWrapper> {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "connect"));
  }

  forceConnect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper>;
  forceConnect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip: ConnectionPlugin | null): Promise<ClientWrapper>;
  forceConnect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip?: ConnectionPlugin | null): Promise<ClientWrapper> {
    const pluginManager = this.servicesContainer.pluginManager;
    if (!pluginManager) {
      throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "forceConnect"));
    }
    return pluginManager.forceConnect(hostInfo, props, true, pluginToSkip ?? null);
  }

  protected updateHostAvailability(hosts: HostInfo[]): void {
    hosts.forEach((host) => {
      const cacheItem = this.storageService.get(HostAvailabilityCacheItem, host.url);
      if (cacheItem != null) {
        host.availability = cacheItem.availability;
      }
    });
  }

  // Error handler methods
  isLoginError(e: Error): boolean {
    return this.dialect.getErrorHandler().isLoginError(e);
  }

  isNetworkError(e: Error): boolean {
    return this.dialect.getErrorHandler().isNetworkError(e);
  }

  isSyntaxError(e: Error): boolean {
    return this.dialect.getErrorHandler().isSyntaxError(e);
  }

  hasLoginError(): boolean {
    return this.dialect.getErrorHandler().hasLoginError();
  }

  hasNetworkError(): boolean {
    return this.dialect.getErrorHandler().hasNetworkError();
  }

  getUnexpectedError(): Error | null {
    return this.dialect.getErrorHandler().getUnexpectedError();
  }

  attachErrorListener(clientWrapper: ClientWrapper | undefined): void {
    this.dialect.getErrorHandler().attachErrorListener(clientWrapper);
  }

  attachNoOpErrorListener(clientWrapper: ClientWrapper | undefined): void {
    this.dialect.getErrorHandler().attachNoOpErrorListener(clientWrapper);
  }

  removeErrorListener(clientWrapper: ClientWrapper | undefined): void {
    this.dialect.getErrorHandler().removeErrorListener(clientWrapper);
  }

  getDialect(): DatabaseDialect {
    return this.dialect;
  }

  async updateDialect(targetClient: ClientWrapper): Promise<void> {
    // Do nothing. This method is called after connecting in DefaultConnectionPlugin but the dialect passed to the
    // constructor should already be updated and verified.
  }

  async identifyConnection(targetClient: ClientWrapper): Promise<HostInfo | null> {
    const provider = this.getHostListProvider();
    if (!provider) {
      return Promise.reject(new AwsWrapperError(Messages.get("PluginService.errorIdentifyConnection")));
    }
    return provider.identifyConnection(targetClient);
  }

  async fillAliases(targetClient: ClientWrapper, hostInfo: HostInfo): Promise<void> {
    if (!hostInfo) {
      return;
    }

    if (hostInfo.aliases.size > 0) {
      logger.debug(Messages.get("PluginService.nonEmptyAliases", [...hostInfo.aliases].join(", ")));
      return;
    }

    hostInfo.addAlias(hostInfo.asAlias);

    try {
      const res = await this.dialect.getHostAliasAndParseResults(targetClient);
      if (res) {
        hostInfo.addAlias(res);
      }
    } catch (error) {
      logger.debug(Messages.get("PluginService.failedToRetrieveHostPort"));
    }

    try {
      const host = await this.identifyConnection(targetClient);
      if (host && host.allAliases) {
        hostInfo.addAlias(...host.allAliases);
      }
    } catch (error) {
      // Ignore errors from identifyConnection
      logger.debug(Messages.get("PluginService.failedToRetrieveHostPort"));
    }
  }

  getHostInfoBuilder(): HostInfoBuilder {
    return new HostInfoBuilder({ hostAvailabilityStrategy: new HostAvailabilityStrategyFactory().create(this.props) });
  }

  getProperties(): Map<string, any> {
    return this.props;
  }

  getTelemetryFactory(): TelemetryFactory {
    const pluginManager = this.servicesContainer.pluginManager;
    if (!pluginManager) {
      throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "getTelemetryFactory"));
    }
    return pluginManager.getTelemetryFactory();
  }

  getSessionStateService(): SessionStateService {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "getSessionStateService"));
  }

  async updateState(sql: string): Promise<void> {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "updateState"));
  }

  updateInTransaction(sql: string): void {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "updateInTransaction"));
  }

  async isClientValid(targetClient: ClientWrapper): Promise<boolean> {
    return await this.getDialect().isClientValid(targetClient);
  }

  async abortCurrentClient(): Promise<void> {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "abortCurrentClient"));
  }

  async abortTargetClient(targetClient: ClientWrapper | undefined | null): Promise<void> {
    if (targetClient) {
      await targetClient.abort();
    }
  }

  updateConfigWithProperties(props: Map<string, any>): void {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "updateConfigWithProperties"));
  }

  setAllowedAndBlockedHosts(allowedAndBlockedHosts: AllowedAndBlockedHosts): void {
    this.allowedAndBlockedHosts = allowedAndBlockedHosts;
  }

  setStatus<T>(clazz: any, status: T | null, clusterBound: boolean): void;
  setStatus<T>(clazz: any, status: T | null, key: string): void;
  setStatus<T>(clazz: any, status: T | null, clusterBoundOrKey: boolean | string): void {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "setStatus"));
  }

  getStatus<T>(clazz: any, clusterBound: boolean): T;
  getStatus<T>(clazz: any, key: string): T;
  getStatus<T>(clazz: any, clusterBoundOrKey: boolean | string): T {
    throw new AwsWrapperError(Messages.get("PartialPluginService.unexpectedMethodCall", "getStatus"));
  }

  isPluginInUse(plugin: any): boolean {
    try {
      return this.servicesContainer.pluginManager?.isPluginInUse(plugin) ?? false;
    } catch (e) {
      return false;
    }
  }

  getPlugin<T>(pluginClazz: new (...args: any[]) => T): T | null {
    return this.servicesContainer.pluginManager?.unwrapPlugin(pluginClazz) ?? null;
  }

  static clearCache(): void {
    CoreServicesContainer.getInstance().storageService.clear(HostAvailabilityCacheItem);
  }

  isPooledClient(): boolean {
    return this._isPooledClient;
  }

  setIsPooledClient(isPooledClient: boolean): void {
    this._isPooledClient = isPooledClient;
  }
}
