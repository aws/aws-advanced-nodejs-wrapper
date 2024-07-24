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
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { DatabaseDialect, DatabaseType } from "./database_dialect/database_dialect";
import { HostInfoBuilder } from "./host_info_builder";
import { AwsWrapperError } from "./utils/errors";
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

export class PluginService implements ErrorHandler, HostListProviderService {
  private readonly _currentClient: AwsClient;
  private _currentHostInfo?: HostInfo;
  private _hostListProvider?: HostListProvider;
  private _initialConnectionHostInfo?: HostInfo;
  private _isInTransaction: boolean = false;
  private pluginServiceManagerContainer: PluginServiceManagerContainer;
  protected hosts: HostInfo[] = [];
  private dbDialectProvider: DatabaseDialectProvider;
  private initialHost: string;
  private dialect: DatabaseDialect;
  protected readonly sessionStateService: SessionStateService;
  protected static readonly hostAvailabilityExpiringCache: CacheMap<string, HostAvailability> = new CacheMap<string, HostAvailability>();
  readonly props: Map<string, any>;

  constructor(
    container: PluginServiceManagerContainer,
    client: AwsClient,
    dbType: DatabaseType,
    knownDialectsByCode: Map<string, DatabaseDialect>,
    props: Map<string, any>
  ) {
    this._currentClient = client;
    this.pluginServiceManagerContainer = container;
    this.props = props;
    this.dbDialectProvider = new DatabaseDialectManager(knownDialectsByCode, dbType, this.props);
    this.initialHost = props.get(WrapperProperties.HOST.name);
    this.sessionStateService = new SessionStateServiceImpl(this, this.props);
    container.pluginService = this;

    this.dialect = this.dbDialectProvider.getDialect(this.props);
  }

  isInTransaction(): boolean {
    return this._isInTransaction;
  }

  setInTransaction(inTransaction: boolean): void {
    this._isInTransaction = inTransaction;
  }

  isLoginError(e: Error): boolean {
    return this.getCurrentClient().errorHandler.isLoginError(e);
  }

  isNetworkError(e: Error): boolean {
    return this.getCurrentClient().errorHandler.isNetworkError(e);
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

  getHostInfoByStrategy(role: HostRole, strategy: string): HostInfo | undefined {
    const pluginManager = this.pluginServiceManagerContainer.pluginManager;
    return pluginManager?.getHostInfoByStrategy(role, strategy);
  }

  getCurrentHostInfo(): HostInfo | null {
    return this._currentHostInfo ? this._currentHostInfo : null;
  }

  setCurrentHostInfo(value: HostInfo) {
    this._currentHostInfo = value;
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
  async forceRefreshHostList(targetClient?: any): Promise<void>;
  async forceRefreshHostList(targetClient?: any): Promise<void> {
    const updatedHostList = targetClient
      ? await this.getHostListProvider()?.forceRefresh(targetClient)
      : await this.getHostListProvider()?.forceRefresh();
    if (updatedHostList && updatedHostList !== this.hosts) {
      this.updateHostAvailability(updatedHostList);
      this.setHostList(this.hosts, updatedHostList);
    }
  }

  async refreshHostList(): Promise<void>;
  async refreshHostList(targetClient: any): Promise<void>;
  async refreshHostList(targetClient?: any): Promise<void> {
    const updatedHostList = targetClient ? await this.getHostListProvider()?.refresh(targetClient) : await this.getHostListProvider()?.refresh();
    if (updatedHostList && updatedHostList !== this.hosts) {
      this.updateHostAvailability(updatedHostList);
      this.setHostList(this.hosts, updatedHostList);
    }
  }

  private updateHostAvailability(hosts: HostInfo[]) {
    hosts.forEach((host) => {
      const availability = PluginService.hostAvailabilityExpiringCache.get(host.url);
      if (availability != null) {
        host.availability = availability;
      }
    });
  }

  private compare(hostInfoA: HostInfo, hostInfoB: HostInfo): Set<HostChangeOptions> {
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

  private setHostList(oldHosts: HostInfo[], newHosts: HostInfo[]) {
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
      if (this.pluginServiceManagerContainer.pluginManager) {
        this.pluginServiceManagerContainer.pluginManager.notifyHostListChanged(changes);
      } else {
        throw new AwsWrapperError("Connection Plugin Manager was not detected."); // This should not be reached
      }
    }
  }

  getHosts(): HostInfo[] {
    return this.hosts;
  }

  setAvailability(hostAliases: Set<string>, availability: HostAvailability) {}

  updateConfigWithProperties(props: Map<string, any>) {
    this._currentClient.config = Object.fromEntries(props.entries());
  }

  createTargetClient(props: Map<string, any>): any {
    const createClientFunc = this.getCurrentClient().getCreateClientFunc();
    const copy = WrapperProperties.removeWrapperProperties(Object.fromEntries(props.entries()));
    if (createClientFunc) {
      return createClientFunc(Object.fromEntries(new Map(Object.entries(copy))));
    }
    throw new AwsWrapperError("AwsClient is missing create target client function."); // This should not be reached
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>): any {
    return this.pluginServiceManagerContainer.pluginManager?.connect(hostInfo, props, false);
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>): any {
    return this.pluginServiceManagerContainer.pluginManager?.forceConnect(hostInfo, props, false);
  }

  async setCurrentClient(newClient: any, hostInfo: HostInfo): Promise<Set<HostChangeOptions>> {
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
        const changes: Set<HostChangeOptions> = this.compare(this._currentHostInfo, hostInfo);

        if (changes.size > 0) {
          const oldClient: any = this.getCurrentClient().targetClient;
          const isInTransaction = this.isInTransaction;
          this.sessionStateService.begin();

          try {
            this.getCurrentClient().resetState();
            this.getCurrentClient().targetClient = newClient;
            this._currentHostInfo = hostInfo;
            await this.sessionStateService.applyCurrentSessionState(this.getCurrentClient());
            this.setInTransaction(false);

            if (this.pluginServiceManagerContainer.pluginManager) {
              const pluginOpinions: Set<OldConnectionSuggestionAction> =
                await this.pluginServiceManagerContainer.pluginManager.notifyConnectionChanged(changes, null);

              const shouldCloseConnection =
                changes.has(HostChangeOptions.CONNECTION_OBJECT_CHANGED) &&
                !pluginOpinions.has(OldConnectionSuggestionAction.PRESERVE) &&
                (await oldClient.isValid());
              // TODO: Review should tryClosingTargetClient(oldClient) be called here, or at some point in this setCurrentClient method?
            }
          } finally {
            this.sessionStateService.complete();
          }
        }
        return changes;
      }
      throw new AwsWrapperError("HostInfo not found"); // Should not be reached
    }
  }

  async isClientValid(targetClient: any): Promise<boolean> {
    return await this.getDialect().isClientValid(targetClient);
  }

  async tryClosingTargetClient(): Promise<void>;
  async tryClosingTargetClient(targetClient: any): Promise<void>;
  async tryClosingTargetClient(targetClient?: any): Promise<void> {
    await this.getDialect().tryClosingTargetClient(targetClient ?? this._currentClient.targetClient);
  }

  getConnectFunc(targetClient: any): () => Promise<any> {
    return this.getDialect().getConnectFunc(targetClient);
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

  async updateDialect(targetClient: any) {
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
      await this.getCurrentClient().setReadOnly(updateReadOnly);
    }
  }

  private async updateAutoCommit(statements: string[]) {
    const updateAutoCommit = SqlMethodUtils.doesSetAutoCommit(statements, this.getDialect());
    if (updateAutoCommit !== undefined) {
      await this.getCurrentClient().setAutoCommit(updateAutoCommit);
    }
  }

  private async updateCatalog(statements: string[]) {
    const updateCatalog = SqlMethodUtils.doesSetCatalog(statements, this.getDialect());
    if (updateCatalog !== undefined) {
      await this.getCurrentClient().setCatalog(updateCatalog);
    }
  }

  private async updateSchema(statements: string[]) {
    const updateSchema = SqlMethodUtils.doesSetSchema(statements, this.getDialect());
    if (updateSchema !== undefined) {
      await this.getCurrentClient().setSchema(updateSchema);
    }
  }

  private async updateTransactionIsolation(statements: string[]) {
    const updateTransactionIsolation = SqlMethodUtils.doesSetTransactionIsolation(statements, this.getDialect());
    if (updateTransactionIsolation !== undefined) {
      await this.getCurrentClient().setTransactionIsolation(updateTransactionIsolation);
    }
  }

  identifyConnection(client: any): Promise<void | HostInfo | null> | undefined {
    return this.getHostListProvider()?.identifyConnection(client, this.dialect);
  }

  getHostRole(client: any): Promise<HostRole> | undefined {
    return this._hostListProvider?.getHostRole(client, this.dialect);
  }
}
