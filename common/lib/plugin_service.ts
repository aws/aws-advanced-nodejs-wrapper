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
import { ClientWrapper } from "./client_wrapper";
import { logger } from "../logutils";
import { Messages } from "./utils/messages";
import { DatabaseDialectCodes } from "./database_dialect/database_dialect_codes";
import { getWriter } from "./utils/utils";
import { ConnectionProvider } from "./connection_provider";
import { TelemetryFactory } from "./utils/telemetry/telemetry_factory";

export class PluginService implements ErrorHandler, HostListProviderService {
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
  protected readonly sessionStateService: SessionStateService;
  protected static readonly hostAvailabilityExpiringCache: CacheMap<string, HostAvailability> = new CacheMap<string, HostAvailability>();
  readonly props: Map<string, any>;

  constructor(
    container: PluginServiceManagerContainer,
    client: AwsClient,
    dbType: DatabaseType,
    knownDialectsByCode: Map<DatabaseDialectCodes, DatabaseDialect>,
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
    if (!this._currentHostInfo) {
      this._currentHostInfo = this._initialConnectionHostInfo;

      if (!this._currentHostInfo) {
        if (this.getHosts().length === 0) {
          throw new AwsWrapperError(Messages.get("PluginService.hostListEmpty"));
        }

        const writerHost = getWriter(this.getHosts());
        if (writerHost) {
          this._currentHostInfo = writerHost;
        } else {
          this._currentHostInfo = this.getHosts()[0];
        }
      }
    }

    return this._currentHostInfo;
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

  getConnectionProvider(hostInfo: HostInfo | null, props: Map<string, any>): ConnectionProvider {
    if (!this.pluginServiceManagerContainer.pluginManager) {
      throw new AwsWrapperError("Plugin manager should not be undefined");
    }
    return this.pluginServiceManagerContainer.pluginManager.getConnectionProvider(hostInfo, props);
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
      const availability = PluginService.hostAvailabilityExpiringCache.get(host.url);
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

  getHosts(): HostInfo[] {
    return this.hosts;
  }

  setAvailability(hostAliases: Set<string>, availability: HostAvailability) {}

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

  identifyConnection(targetClient: ClientWrapper): Promise<HostInfo | void | null> {
    const provider: HostListProvider | null = this.getHostListProvider();
    if (provider === null) {
      return Promise.reject();
    }
    return provider.identifyConnection(targetClient, this.dialect);
  }

  createTargetClient(props: Map<string, any>): any {
    const createClientFunc = this.getCurrentClient().getCreateClientFunc();
    if (createClientFunc) {
      return createClientFunc(props);
    }
    throw new AwsWrapperError("AwsClient is missing create target client function."); // This should not be reached
  }

  connect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper> {
    return this.pluginServiceManagerContainer.pluginManager!.connect(hostInfo, props, false);
  }

  forceConnect(hostInfo: HostInfo, props: Map<string, any>): Promise<ClientWrapper> {
    return this.pluginServiceManagerContainer.pluginManager!.forceConnect(hostInfo, props, false);
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
            this.getCurrentClient().resetState();
            this.getCurrentClient().targetClient = newClient;
            this._currentHostInfo = hostInfo;
            await this.sessionStateService.applyCurrentSessionState(this.getCurrentClient());
            this.setInTransaction(false);

            if (oldClient && (isInTransaction || WrapperProperties.ROLLBACK_ON_SWITCH.get(this.props))) {
              try {
                await this.getDialect().rollback(oldClient);
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
                await this.tryClosingTargetClient(oldClient);
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
      throw new AwsWrapperError("HostInfo not found"); // Should not be reached
    }
  }

  async isClientValid(targetClient: ClientWrapper): Promise<boolean> {
    return await this.getDialect().isClientValid(targetClient);
  }

  async abortCurrentClient(): Promise<void> {
    if (this._currentClient.targetClient) {
      await this.getDialect().tryClosingTargetClient(this._currentClient.targetClient);
    }
  }

  async tryClosingTargetClient(targetClient: ClientWrapper): Promise<void> {
    await this.getDialect().tryClosingTargetClient(targetClient);
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

  getConnectionProvider(): ConnectionProvider {
    return this.pluginServiceManagerContainer.pluginManager!.getDefaultConnProvider();
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

  getHostRole(client: any): Promise<HostRole> | undefined {
    return this._hostListProvider?.getHostRole(client, this.dialect);
  }

  async rollback(targetClient: ClientWrapper) {
    return await this.getDialect().rollback(targetClient);
  }

  getTelemetryFactory(): TelemetryFactory {
    return this.pluginServiceManagerContainer.pluginManager!.getTelemetryFactory();
  }
}
