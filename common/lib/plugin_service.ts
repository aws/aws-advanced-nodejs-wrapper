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

import { PluginServiceManagerContainer } from "./plugin_service_manager_container";
import { ErrorHandler } from "./error_handler";
import { HostInfo } from "./host_info";
import { AwsClient } from "./aws_client";
import { HostListProviderService } from "./host_list_provider_service";
import { BlockingHostListProvider, HostListProvider } from "./host_list_provider/host_list_provider";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { DatabaseDialect, DatabaseType } from "./database_dialect/database_dialect";
import { HostInfoBuilder } from "./host_info_builder";
import { AwsWrapperError } from "./";
import { HostAvailability } from "./host_availability/host_availability";
import { CacheMap } from "./utils/cache_map";
import { HostChangeOptions } from "./host_change_options";
import { HostRole } from "./host_role";
import { WrapperProperties } from "./wrapper_property";
import { OldConnectionSuggestionAction } from "./old_connection_suggestion_action";
import { DatabaseDialectProvider } from "./database_dialect/database_dialect_provider";
import { DatabaseDialectManager } from "./database_dialect/database_dialect_manager";
import { SqlMethodUtils } from "./utils/sql_method_utils";
import { SessionStateService } from "./session_state_service";
import { SessionStateServiceImpl } from "./session_state_service_impl";
import { HostAvailabilityStrategyFactory } from "./host_availability/host_availability_strategy_factory";
import { ClientWrapper } from "./client_wrapper";
import { logger } from "../logutils";
import { Messages } from "./utils/messages";
import { DatabaseDialectCodes } from "./database_dialect/database_dialect_codes";
import { getWriter, logTopology } from "./utils/utils";
import { TelemetryFactory } from "./utils/telemetry/telemetry_factory";
import { DriverDialect } from "./driver_dialect/driver_dialect";
import { AllowedAndBlockedHosts } from "./allowed_and_blocked_hosts";
import { ConnectionPlugin } from "./connection_plugin";

export interface PluginService extends ErrorHandler {
  isInTransaction(): boolean;

  setInTransaction(inTransaction: boolean): void;

  getHostListProvider(): HostListProvider | null;

  getInitialConnectionHostInfo(): HostInfo | null;

  setHostListProvider(hostListProvider: HostListProvider): void;

  setInitialConnectionHostInfo(initialConnectionHostInfo: HostInfo): void;

  getHostInfoByStrategy(role: HostRole, strategy: string, hosts?: HostInfo[]): HostInfo | undefined;

  getCurrentHostInfo(): HostInfo | null;

  setCurrentHostInfo(value: HostInfo): void;

  getCurrentClient(): AwsClient;

  getConnectionUrlParser(): ConnectionUrlParser;

  getProperties(): Map<string, any>;

  getDialect(): DatabaseDialect;

  getDriverDialect(): DriverDialect;

  getHostInfoBuilder(): HostInfoBuilder;

  isStaticHostListProvider(): boolean;

  acceptsStrategy(role: HostRole, strategy: string): boolean;

  forceRefreshHostList(): Promise<void>;

  forceRefreshHostList(targetClient: ClientWrapper): Promise<void>;

  forceRefreshHostList(targetClient?: ClientWrapper): Promise<void>;

  forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<boolean>;

  refreshHostList(): Promise<void>;

  refreshHostList(targetClient: ClientWrapper): Promise<void>;

  refreshHostList(targetClient?: ClientWrapper): Promise<void>;

  getAllHosts(): HostInfo[];

  getHosts(): HostInfo[];

  setAvailability(hostAliases: Set<string>, availability: HostAvailability): void;

  updateConfigWithProperties(props: Map<string, any>): void;

  fillAliases(targetClient: ClientWrapper, hostInfo: HostInfo): Promise<void>;

  identifyConnection(targetClient: ClientWrapper): Promise<HostInfo | null>;

  connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper>;

  connect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip: ConnectionPlugin | null): Promise<ClientWrapper>;

  connect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip?: ConnectionPlugin | null): Promise<ClientWrapper>;

  forceConnect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper>;

  forceConnect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip: ConnectionPlugin | null): Promise<ClientWrapper>;

  forceConnect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip?: ConnectionPlugin | null): Promise<ClientWrapper>;

  setCurrentClient(newClient: ClientWrapper, hostInfo: HostInfo): Promise<Set<HostChangeOptions>>;

  isClientValid(targetClient: ClientWrapper): Promise<boolean>;

  abortCurrentClient(): Promise<void>;

  abortTargetClient(targetClient: ClientWrapper | undefined | null): Promise<void>;

  getSessionStateService(): SessionStateService;

  updateState(sql: string): Promise<void>;

  updateInTransaction(sql: string): void;

  updateDialect(targetClient: ClientWrapper): Promise<void>;

  getHostRole(client: any): Promise<HostRole> | undefined;

  getTelemetryFactory(): TelemetryFactory;

  setAllowedAndBlockedHosts(allowedAndBlockedHosts: AllowedAndBlockedHosts): void;

  setStatus<T>(clazz: any, status: T | null, clusterBound: boolean): void;

  setStatus<T>(clazz: any, status: T | null, key: string): void;

  getStatus<T>(clazz: any, clusterBound: boolean): T;

  getStatus<T>(clazz: any, key: string): T;

  isPluginInUse(plugin: any): boolean;
}

export class PluginServiceImpl implements PluginService, HostListProviderService {
  private static readonly DEFAULT_HOST_AVAILABILITY_CACHE_EXPIRE_NANO = 5 * 60_000_000_000; // 5 minutes
  private readonly _currentClient: AwsClient;
  private _currentHostInfo?: HostInfo;
  private _hostListProvider?: HostListProvider;
  private _initialConnectionHostInfo?: HostInfo;
  private _isInTransaction: boolean = false;
  private pluginServiceManagerContainer: PluginServiceManagerContainer;
  protected hosts: HostInfo[] = [];
  private dbDialectProvider: DatabaseDialectProvider;
  private readonly initialHost: string;
  private dialect: DatabaseDialect;
  private readonly driverDialect: DriverDialect;
  protected readonly sessionStateService: SessionStateService;
  protected static readonly hostAvailabilityExpiringCache: CacheMap<string, HostAvailability> = new CacheMap<string, HostAvailability>();
  readonly props: Map<string, any>;
  private allowedAndBlockedHosts: AllowedAndBlockedHosts | null = null;
  protected static readonly statusesExpiringCache: CacheMap<string, any> = new CacheMap();
  protected static readonly DEFAULT_STATUS_CACHE_EXPIRE_NANO: number = 3_600_000_000_000; // 60 minutes

  constructor(
    container: PluginServiceManagerContainer,
    client: AwsClient,
    dbType: DatabaseType,
    knownDialectsByCode: Map<DatabaseDialectCodes, DatabaseDialect>,
    props: Map<string, any>,
    driverDialect: DriverDialect
  ) {
    this._currentClient = client;
    this.pluginServiceManagerContainer = container;
    this.props = props;
    this.dbDialectProvider = new DatabaseDialectManager(knownDialectsByCode, dbType, this.props);
    this.driverDialect = driverDialect;
    this.initialHost = props.get(WrapperProperties.HOST.name);
    container.pluginService = this;

    this.dialect = WrapperProperties.CUSTOM_DATABASE_DIALECT.get(this.props) ?? this.dbDialectProvider.getDialect(this.props);
    this.sessionStateService = new SessionStateServiceImpl(this, this.props);
  }

  isInTransaction(): boolean {
    return this._isInTransaction;
  }

  setInTransaction(inTransaction: boolean): void {
    this._isInTransaction = inTransaction;
  }

  getHostListProvider(): HostListProvider | null {
    return this._hostListProvider ? this._hostListProvider : null;
  }

  getInitialConnectionHostInfo(): HostInfo | null {
    return this._initialConnectionHostInfo ? this._initialConnectionHostInfo : null;
  }

  setHostListProvider(hostListProvider: HostListProvider): void {
    this._hostListProvider = hostListProvider;
  }

  setInitialConnectionHostInfo(initialConnectionHostInfo: HostInfo): void {
    this._initialConnectionHostInfo = initialConnectionHostInfo;
  }

  getHostInfoByStrategy(role: HostRole, strategy: string, hosts?: HostInfo[]): HostInfo | undefined {
    const pluginManager = this.pluginServiceManagerContainer.pluginManager;
    return pluginManager?.getHostInfoByStrategy(role, strategy, hosts);
  }

  getCurrentHostInfo(): HostInfo | null {
    if (!this._currentHostInfo) {
      this._currentHostInfo = this._initialConnectionHostInfo;

      if (!this._currentHostInfo) {
        if (this.getAllHosts().length === 0) {
          throw new AwsWrapperError(Messages.get("PluginService.hostListEmpty"));
        }

        const writerHost = getWriter(this.getAllHosts());
        if (writerHost) {
          this._currentHostInfo = writerHost;
          if (!this.getHosts().some((hostInfo: HostInfo) => hostInfo.host === writerHost?.host)) {
            throw new AwsWrapperError(
              Messages.get(
                "PluginService.currentHostNotAllowed",
                this._currentHostInfo ? this._currentHostInfo.host : "<null>",
                logTopology(this.hosts, "[PluginService.currentHostNotAllowed] ")
              )
            );
          }
        }

        if (!this._currentHostInfo) {
          this._currentHostInfo = this.getHosts()[0];
        }
      }

      if (!this._currentHostInfo) {
        throw new AwsWrapperError(Messages.get("PluginService.currentHostNotDefined"));
      }

      logger.debug(`Set current host to: ${this._currentHostInfo.host}`);
    }

    return this._currentHostInfo;
  }

  setCurrentHostInfo(value: HostInfo) {
    this._currentHostInfo = value;
  }

  getProperties(): Map<string, any> {
    return this.props;
  }

  getCurrentClient(): AwsClient {
    return this._currentClient;
  }

  getConnectionUrlParser(): ConnectionUrlParser {
    return this.getCurrentClient().connectionUrlParser;
  }

  getDialect(): DatabaseDialect {
    return this.dialect;
  }

  getDriverDialect(): DriverDialect {
    return this.driverDialect;
  }

  getHostInfoBuilder(): HostInfoBuilder {
    return new HostInfoBuilder({ hostAvailabilityStrategy: new HostAvailabilityStrategyFactory().create(this.props) });
  }

  isStaticHostListProvider(): boolean {
    return false;
  }

  acceptsStrategy(role: HostRole, strategy: string): boolean {
    return this.pluginServiceManagerContainer.pluginManager?.acceptsStrategy(role, strategy) ?? false;
  }

  async forceRefreshHostList(): Promise<void>;
  async forceRefreshHostList(targetClient: ClientWrapper): Promise<void>;
  async forceRefreshHostList(targetClient?: ClientWrapper): Promise<void> {
    const updatedHostList = targetClient
      ? await this.getHostListProvider()?.forceRefresh(targetClient)
      : await this.getHostListProvider()?.forceRefresh();
    if (updatedHostList && updatedHostList !== this.hosts) {
      this.updateHostAvailability(updatedHostList);
      await this.setHostList(this.hosts, updatedHostList);
    }
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<boolean> {
    const hostListProvider: HostListProvider = this.getHostListProvider();
    if (!this.isBlockingHostListProvider(hostListProvider)) {
      logger.info(Messages.get("PluginService.requiredBlockingHostListProvider", typeof hostListProvider));
      throw new AwsWrapperError(Messages.get("PluginService.requiredBlockingHostListProvider", typeof hostListProvider));
    }

    try {
      const updatedHostList: HostInfo[] = await hostListProvider.forceMonitoringRefresh(shouldVerifyWriter, timeoutMs);
      if (updatedHostList) {
        if (updatedHostList !== this.hosts) {
          this.updateHostAvailability(updatedHostList);
          await this.setHostList(this.hosts, updatedHostList);
        }
        return true;
      }
    } catch (err) {
      // Do nothing.
      logger.info(Messages.get("PluginService.forceMonitoringRefreshTimeout", timeoutMs.toString()));
    }

    return false;
  }

  isBlockingHostListProvider(arg: any): arg is BlockingHostListProvider {
    return arg != null && typeof arg.clearAll === "function" && typeof arg.forceMonitoringRefresh === "function";
  }

  async refreshHostList(): Promise<void>;
  async refreshHostList(targetClient: ClientWrapper): Promise<void>;
  async refreshHostList(targetClient?: ClientWrapper): Promise<void> {
    const updatedHostList = targetClient ? await this.getHostListProvider()?.refresh(targetClient) : await this.getHostListProvider()?.refresh();
    if (updatedHostList && updatedHostList !== this.hosts) {
      this.updateHostAvailability(updatedHostList);
      await this.setHostList(this.hosts, updatedHostList);
    }
  }

  private updateHostAvailability(hosts: HostInfo[]) {
    hosts.forEach((host) => {
      const availability = PluginServiceImpl.hostAvailabilityExpiringCache.get(host.url);
      if (availability != null) {
        host.availability = availability;
      }
    });
  }

  private compare(hostInfoA: HostInfo, hostInfoB: HostInfo): Set<HostChangeOptions>;
  private compare(hostInfoA: HostInfo, hostInfoB: HostInfo, clientA: ClientWrapper, clientB: ClientWrapper): Set<HostChangeOptions>;
  private compare(hostInfoA: HostInfo, hostInfoB: HostInfo, clientA?: ClientWrapper, clientB?: ClientWrapper): Set<HostChangeOptions> {
    const changes: Set<HostChangeOptions> = new Set<HostChangeOptions>();

    if (clientA && clientB && !Object.is(clientA, clientB)) {
      changes.add(HostChangeOptions.CONNECTION_OBJECT_CHANGED);
    }

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

  private async setHostList(oldHosts: HostInfo[], newHosts: HostInfo[]) {
    const oldHostMap: Map<string, HostInfo> = new Map(oldHosts.map((e) => [e.url, e]));
    const newHostMap: Map<string, HostInfo> = new Map(newHosts.map((e) => [e.url, e]));

    const changes: Map<string, Set<HostChangeOptions>> = new Map<string, Set<HostChangeOptions>>();
    oldHostMap.forEach((value, key) => {
      const correspondingNewHost: HostInfo | undefined = newHostMap.get(key);
      if (!correspondingNewHost) {
        changes.set(key, new Set([HostChangeOptions.HOST_DELETED]));
      } else {
        const hostChanges: Set<HostChangeOptions> = this.compare(value, correspondingNewHost);
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
      await this.pluginServiceManagerContainer.pluginManager!.notifyHostListChanged(changes);
    }
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

  setAvailability(hostAliases: Set<string>, availability: HostAvailability) {
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
      logger.debug(Messages.get("PluginService.hostsChangeListEmpty"));
      return;
    }

    const changes = new Map<string, Set<HostChangeOptions>>();
    for (const host of hostsToChange) {
      const currentAvailability = host.getAvailability();
      PluginServiceImpl.hostAvailabilityExpiringCache.put(host.url, availability, PluginServiceImpl.DEFAULT_HOST_AVAILABILITY_CACHE_EXPIRE_NANO);
      if (currentAvailability !== availability) {
        let hostChanges = new Set<HostChangeOptions>();
        if (availability === HostAvailability.AVAILABLE) {
          hostChanges = new Set([HostChangeOptions.WENT_UP, HostChangeOptions.HOST_CHANGED]);
        } else {
          hostChanges = new Set([HostChangeOptions.WENT_DOWN, HostChangeOptions.HOST_CHANGED]);
        }
        changes.set(host.url, hostChanges);
      }
    }
  }

  updateConfigWithProperties(props: Map<string, any>) {
    this._currentClient.config = Object.fromEntries(props.entries());
  }

  async fillAliases(targetClient: ClientWrapper, hostInfo: HostInfo) {
    if (hostInfo == null) {
      return;
    }

    if (hostInfo.aliases.size > 0) {
      logger.debug(Messages.get("PluginService.nonEmptyAliases", [...hostInfo.aliases].join(", ")));
      return;
    }

    hostInfo.addAlias(hostInfo.asAlias);

    // Add the host name and port, this host name is usually the internal IP address.
    try {
      const res: string = await this.dialect.getHostAliasAndParseResults(targetClient);
      hostInfo.addAlias(res);
    } catch (error) {
      logger.debug(Messages.get("PluginService.failedToRetrieveHostPort"));
    }

    const host: HostInfo | void | null = await this.identifyConnection(targetClient);
    if (host) {
      hostInfo.addAlias(...host.allAliases);
    }
  }

  identifyConnection(targetClient: ClientWrapper): Promise<HostInfo | null> {
    const provider: HostListProvider | null = this.getHostListProvider();
    if (!provider) {
      return Promise.reject();
    }
    return provider.identifyConnection(targetClient, this.dialect);
  }

  connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper>;
  connect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip: ConnectionPlugin): Promise<ClientWrapper>;
  connect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip?: ConnectionPlugin): Promise<ClientWrapper> {
    return this.pluginServiceManagerContainer.pluginManager!.connect(hostInfo, props, false, pluginToSkip);
  }

  forceConnect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper>;
  forceConnect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip: ConnectionPlugin): Promise<ClientWrapper>;
  forceConnect(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip?: ConnectionPlugin): Promise<ClientWrapper> {
    return this.pluginServiceManagerContainer.pluginManager!.forceConnect(hostInfo, props, false, pluginToSkip);
  }

  async setCurrentClient(newClient: ClientWrapper, hostInfo: HostInfo): Promise<Set<HostChangeOptions>> {
    if (!this.getCurrentClient().targetClient) {
      this.getCurrentClient().targetClient = newClient;
      this._currentHostInfo = hostInfo;
      this.sessionStateService.reset();
      const changes = new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]);

      if (this.pluginServiceManagerContainer.pluginManager) {
        await this.pluginServiceManagerContainer.pluginManager.notifyConnectionChanged(changes, null);
      }

      return changes;
    } else {
      if (this._currentHostInfo) {
        const oldClient = this.getCurrentClient().targetClient;
        const changes: Set<HostChangeOptions> = this.compare(this._currentHostInfo, newClient.hostInfo, oldClient!, newClient);

        if (changes.size > 0) {
          const isInTransaction = this.isInTransaction();
          this.sessionStateService.begin();

          try {
            this.getCurrentClient().targetClient = newClient;
            this._currentHostInfo = hostInfo;
            await this.sessionStateService.applyCurrentSessionState(this.getCurrentClient());
            this.setInTransaction(false);

            if (oldClient && (isInTransaction || WrapperProperties.ROLLBACK_ON_SWITCH.get(this.props))) {
              try {
                await oldClient.rollback();
              } catch (error: any) {
                // Ignore.
              }
            }

            const pluginOpinions: Set<OldConnectionSuggestionAction> =
              await this.pluginServiceManagerContainer.pluginManager!.notifyConnectionChanged(changes, null);

            const shouldCloseConnection =
              changes.has(HostChangeOptions.CONNECTION_OBJECT_CHANGED) &&
              !pluginOpinions.has(OldConnectionSuggestionAction.PRESERVE) &&
              oldClient &&
              (await this.isClientValid(oldClient));

            if (shouldCloseConnection) {
              try {
                await this.sessionStateService.applyPristineSessionState(this.getCurrentClient());
              } catch (error: any) {
                // Ignore.
              }

              try {
                await this.abortTargetClient(oldClient);
              } catch (error: any) {
                // Ignore.
              }
            }
          } finally {
            this.sessionStateService.complete();
          }
        }
        return changes;
      }
      throw new AwsWrapperError(Messages.get("HostInfo.noHostParameter")); // Should not be reached
    }
  }

  async isClientValid(targetClient: ClientWrapper): Promise<boolean> {
    return await this.getDialect().isClientValid(targetClient);
  }

  async abortCurrentClient(): Promise<void> {
    if (this._currentClient.targetClient) {
      await this._currentClient.targetClient.abort();
    }
  }

  async abortTargetClient(targetClient: ClientWrapper | undefined | null): Promise<void> {
    if (targetClient) {
      await targetClient.abort();
    }
  }

  getSessionStateService() {
    return this.sessionStateService;
  }

  async updateState(sql: string) {
    this.updateInTransaction(sql);

    const statements = SqlMethodUtils.parseMultiStatementQueries(sql);
    await this.updateReadOnly(statements);
    await this.updateAutoCommit(statements);
    await this.updateCatalog(statements);
    await this.updateSchema(statements);
    await this.updateTransactionIsolation(statements);
  }

  updateInTransaction(sql: string) {
    if (SqlMethodUtils.doesOpenTransaction(sql)) {
      this.setInTransaction(true);
    } else if (SqlMethodUtils.doesCloseTransaction(sql)) {
      this.setInTransaction(false);
    }
  }

  async updateDialect(targetClient: ClientWrapper) {
    const originalDialect = this.dialect;
    this.dialect = await this.dbDialectProvider.getDialectForUpdate(targetClient, this.initialHost, this.props.get(WrapperProperties.HOST.name));

    if (originalDialect === this.dialect) {
      return;
    }

    this._hostListProvider = this.dialect.getHostListProvider(this.props, this.props.get(WrapperProperties.HOST.name), this);
  }

  private async updateReadOnly(statements: string[]) {
    const updateReadOnly = SqlMethodUtils.doesSetReadOnly(statements, this.getDialect());
    if (updateReadOnly !== undefined) {
      this.getSessionStateService().setReadOnly(updateReadOnly);
    }
  }

  private async updateAutoCommit(statements: string[]) {
    const updateAutoCommit = SqlMethodUtils.doesSetAutoCommit(statements, this.getDialect());
    if (updateAutoCommit !== undefined) {
      this.getSessionStateService().setAutoCommit(updateAutoCommit);
    }
  }

  private async updateCatalog(statements: string[]) {
    const updateCatalog = SqlMethodUtils.doesSetCatalog(statements, this.getDialect());
    if (updateCatalog !== undefined) {
      this.getSessionStateService().setCatalog(updateCatalog);
    }
  }

  private async updateSchema(statements: string[]) {
    const updateSchema = SqlMethodUtils.doesSetSchema(statements, this.getDialect());
    if (updateSchema !== undefined) {
      this.getSessionStateService().setSchema(updateSchema);
    }
  }

  private async updateTransactionIsolation(statements: string[]) {
    const updateTransactionIsolation = SqlMethodUtils.doesSetTransactionIsolation(statements, this.getDialect());
    if (updateTransactionIsolation !== undefined) {
      this.getSessionStateService().setTransactionIsolation(updateTransactionIsolation);
    }
  }

  getHostRole(client: any): Promise<HostRole> | undefined {
    return this._hostListProvider?.getHostRole(client, this.dialect);
  }

  getTelemetryFactory(): TelemetryFactory {
    return this.pluginServiceManagerContainer.pluginManager!.getTelemetryFactory();
  }

  /* Error Handler interface implementation */

  isLoginError(e: Error): boolean {
    return this.getDialect().getErrorHandler().isLoginError(e);
  }

  isNetworkError(e: Error): boolean {
    return this.getDialect().getErrorHandler().isNetworkError(e);
  }

  isSyntaxError(e: Error): boolean {
    return this.getDialect().getErrorHandler().isSyntaxError(e);
  }

  hasLoginError(): boolean {
    return this.getDialect().getErrorHandler().hasLoginError();
  }

  hasNetworkError(): boolean {
    return this.getDialect().getErrorHandler().hasNetworkError();
  }

  getUnexpectedError(): Error | null {
    return this.getDialect().getErrorHandler().getUnexpectedError();
  }

  attachErrorListener(clientWrapper: ClientWrapper | undefined): void {
    this.getDialect().getErrorHandler().attachErrorListener(clientWrapper);
  }

  attachNoOpErrorListener(clientWrapper: ClientWrapper | undefined): void {
    this.getDialect().getErrorHandler().attachNoOpErrorListener(clientWrapper);
  }

  removeErrorListener(clientWrapper: ClientWrapper | undefined): void {
    this.getDialect().getErrorHandler().removeErrorListener(clientWrapper);
  }

  setAllowedAndBlockedHosts(allowedAndBlockedHosts: AllowedAndBlockedHosts) {
    this.allowedAndBlockedHosts = allowedAndBlockedHosts;
  }

  static clearHostAvailabilityCache(): void {
    PluginServiceImpl.hostAvailabilityExpiringCache.clear();
  }

  getStatus<T>(clazz: any, clusterBound: boolean): T;
  getStatus<T>(clazz: any, key: string): T;
  getStatus<T>(clazz: any, clusterBound: boolean | string): T {
    if (typeof clusterBound === "string") {
      return <T>PluginServiceImpl.statusesExpiringCache.get(this.getStatusCacheKey(clazz, clusterBound));
    }
    let clusterId: string = null;
    if (clusterBound) {
      try {
        clusterId = this._hostListProvider.getClusterId();
      } catch (e) {
        // Do nothing
      }
    }
    return this.getStatus(clazz, clusterId);
  }

  protected getStatusCacheKey<T>(clazz: T, key: string): string {
    return `${!key ? "" : key.trim().toLowerCase()}::${clazz.toString()}`;
  }

  setStatus<T>(clazz: any, status: T | null, clusterBound: boolean): void;
  setStatus<T>(clazz: any, status: T | null, key: string): void;
  setStatus<T>(clazz: any, status: T, clusterBound: boolean | string): void {
    if (typeof clusterBound === "string") {
      const cacheKey: string = this.getStatusCacheKey(clazz, clusterBound);
      if (!status) {
        PluginServiceImpl.statusesExpiringCache.delete(cacheKey);
      } else {
        PluginServiceImpl.statusesExpiringCache.put(cacheKey, status, PluginServiceImpl.DEFAULT_STATUS_CACHE_EXPIRE_NANO);
      }
      return;
    }

    let clusterId: string | null = null;
    if (clusterBound) {
      try {
        clusterId = this._hostListProvider.getClusterId();
      } catch (e) {
        // Do nothing
      }
    }
    this.setStatus(clazz, status, clusterId);
  }

  isPluginInUse(plugin: any) {
    return this.pluginServiceManagerContainer.pluginManager!.isPluginInUse(plugin);
  }
}
