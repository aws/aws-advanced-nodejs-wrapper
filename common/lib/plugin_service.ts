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
import { DatabaseDialect } from "./database_dialect";
import { HostInfoBuilder } from "./host_info_builder";
import { SimpleHostAvailabilityStrategy } from "./host_availability/simple_host_availability_strategy";
import { AwsWrapperError } from "./utils/errors";
import { HostAvailability } from "./host_availability/host_availability";
import { CacheMap } from "./utils/cache_map";
import { HostChangeOptions } from "./host_change_options";
import { HostRole } from "./host_role";
import { WrapperProperties } from "./wrapper_property";
import { PluginManager } from "./plugin_manager";
import { OldConnectionSuggestionAction } from "./old_connection_suggestion_action";
import { logger } from "../logutils";

export class PluginService implements ErrorHandler, HostListProviderService {
  private _currentHostInfo?: HostInfo;
  private _currentClient: AwsClient;
  private _hostListProvider?: HostListProvider;
  private _initialConnectionHostInfo?: HostInfo;
  private _isInTransaction: boolean = false;
  private pluginServiceManagerContainer: PluginServiceManagerContainer;
  protected hosts: HostInfo[] = [];
  protected static readonly hostAvailabilityExpiringCache: CacheMap<string, HostAvailability> = new CacheMap<string, HostAvailability>();

  constructor(container: PluginServiceManagerContainer, client: AwsClient) {
    this._currentClient = client;
    this.pluginServiceManagerContainer = container;
    container.pluginService = this;
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
    return this.getCurrentClient().dialect;
  }

  getHostInfoBuilder(): HostInfoBuilder {
    // TODO: use the availability factory to create the strategy
    return new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
  }

  isStaticHostListProvider(): boolean {
    return false;
  }

  async forceRefreshHostList(): Promise<void>;
  async forceRefreshHostList(client?: AwsClient): Promise<void>;
  async forceRefreshHostList(client?: AwsClient): Promise<void> {
    const updatedHostList = client ? await this.getHostListProvider()?.forceRefresh(client) : await this.getHostListProvider()?.forceRefresh();
    if (updatedHostList && updatedHostList !== this.hosts) {
      this.updateHostAvailability(updatedHostList);
      this.setHostList(this.hosts, updatedHostList);
    }
  }

  async refreshHostList(): Promise<void>;
  async refreshHostList(client: AwsClient): Promise<void>;
  async refreshHostList(client?: AwsClient): Promise<void> {
    const updatedHostList = client ? await this.getHostListProvider()?.refresh(client) : await this.getHostListProvider()?.refresh();
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

  replaceTargetClient(props: Map<string, any>): void {
    const createClientFunc = this.getCurrentClient().getCreateClientFunc();
    if (createClientFunc) {
      if (this.getCurrentClient().targetClient) {
        this.getCurrentClient().end();
      }
      const newTargetClient = createClientFunc(Object.fromEntries(props));
      this.getCurrentClient().targetClient = newTargetClient;
      return;
    }
    throw new AwsWrapperError("AwsClient is missing create target client function."); // This should not be reached
  }

  createTargetClient(props: Map<string, any>): any {
    const createClientFunc = this.getCurrentClient().getCreateClientFunc();
    const copy = WrapperProperties.removeWrapperProperties(Object.fromEntries(props.entries()));
    if (createClientFunc) {
      return createClientFunc(Object.fromEntries(new Map(Object.entries(copy))));
    }
    throw new AwsWrapperError("AwsClient is missing create target client function."); // This should not be reached
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, connectFunc: () => Promise<T>) {
    if (connectFunc) {
      return this.pluginServiceManagerContainer.pluginManager?.connect(hostInfo, props, false, connectFunc);
    }
    throw new AwsWrapperError("AwsClient is missing target client connect function."); // This should not be reached
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, connectFunc: () => Promise<T>) {
    if (connectFunc) {
      return this.pluginServiceManagerContainer.pluginManager?.forceConnect(hostInfo, props, false, connectFunc);
    }
    throw new AwsWrapperError("AwsClient is missing target client connect function."); // This should not be reached
  }

  // TODO: Add more to this later
  async setCurrentClient(newClient: any, hostInfo: HostInfo): Promise<Set<HostChangeOptions>> {
    if (this.getCurrentClient().targetClient === null) {
      this.getCurrentClient().targetClient = newClient;
      this._currentHostInfo = hostInfo;
      const changes = new Set<HostChangeOptions>([HostChangeOptions.INITIAL_CONNECTION]);
      if (this.pluginServiceManagerContainer.pluginManager) {
        this.pluginServiceManagerContainer.pluginManager.notifyConnectionChanged(changes, null);
      }
      return changes;
    } else {
      if (this._currentHostInfo) {
        const changes: Set<HostChangeOptions> = this.compare(this._currentHostInfo, hostInfo);
        if (changes.size > 0) {
          const oldClient: any = this.getCurrentClient().targetClient;
          const isInTransaction = this.isInTransaction;
          try {
            this.getCurrentClient().targetClient = newClient;
            this._currentHostInfo = hostInfo;
            this.setInTransaction(false);

            if (this.pluginServiceManagerContainer.pluginManager) {
              const pluginOpinions: Set<OldConnectionSuggestionAction> =
                await this.pluginServiceManagerContainer.pluginManager.notifyConnectionChanged(changes, null);

              const shouldCloseConnection =
                changes.has(HostChangeOptions.CONNECTION_OBJECT_CHANGED) &&
                !pluginOpinions.has(OldConnectionSuggestionAction.PRESERVE) &&
                oldClient.isValid();
            }
          } finally {
            /* empty */
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

  getConnectFunc(targetClient: any) {
    return this.getDialect().getConnectFunc(targetClient);
  }

  updateInTransaction(sql: string) {
    // TODO: revise with session state transfer
    if (sql.toLowerCase().startsWith("start transaction") || sql.toLowerCase().startsWith("begin")) {
      this.setInTransaction(true);
    } else if (
      sql.toLowerCase().startsWith("commit") ||
      sql.toLowerCase().startsWith("rollback") ||
      sql.toLowerCase().startsWith("end") ||
      sql.toLowerCase().startsWith("abort")
    ) {
      this.setInTransaction(false);
    }
  }
}
