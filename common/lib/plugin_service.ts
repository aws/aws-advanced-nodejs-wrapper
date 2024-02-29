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
import { AwsWrapperError } from "./utils/aws_wrapper_error";
import { HostAvailability } from "./host_availability/host_availability";
import { CacheMap } from "./utils/cache_map";
import { HostChangeOptions } from "./host_change_options";
import { HostRole } from "./host_role";

export class PluginService implements ErrorHandler, HostListProviderService {
  private _currentHostInfo?: HostInfo;
  private _currentClient: AwsClient;
  private _hostListProvider?: HostListProvider;
  private _initialConnectionHostInfo?: HostInfo;
  private pluginServiceManagerContainer: PluginServiceManagerContainer;
  protected hosts: HostInfo[] = [];
  protected static readonly hostAvailabilityExpiringCache: CacheMap<string, HostAvailability> = new CacheMap<string, HostAvailability>();

  constructor(container: PluginServiceManagerContainer, client: AwsClient) {
    this._currentClient = client;
    this.pluginServiceManagerContainer = container;
    container.pluginService = this;
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

  updateCredentials(properties: Map<string, any>) {
    this.getCurrentClient().updateCredentials(properties);
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
  async forceRefreshHostList(client: AwsClient): Promise<void>;
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
      // TODO: uncomment once notifyHostListChanged is implemented.
      // this.pluginServiceManagerContainer.pluginManager.notifyHostListChanged(changes);
    }
  }

  getHosts(): HostInfo[] {
    return this.hosts;
  }

  setAvailability(hostAliases: Set<string>, availability: HostAvailability) {}

  async createTargetClientAndConnect(hostInfo: HostInfo, props: Map<string, any>, forceConnect: boolean): Promise<AwsClient> {
    if (this.pluginServiceManagerContainer.pluginManager) {
      return await this.pluginServiceManagerContainer.pluginManager.createTargetClientAndConnect(hostInfo, props, this._currentClient, forceConnect);
    } else {
      throw new AwsWrapperError("Connection Plugin Manager was not detected."); // This should not be reached
    }
  }

  connect(hostInfo: HostInfo, props: Map<string, any>) {
    const connectFunc = this._currentClient.getConnectFunc();
    if (connectFunc) {
      return this.pluginServiceManagerContainer.pluginManager?.connect(hostInfo, props, false, connectFunc);
    }
    throw new AwsWrapperError("AwsClient is missing target client connect functions."); // This should not be reached
  }

  forceConnect(hostInfo: HostInfo, props: Map<string, any>) {
    const connectFunc = this._currentClient.getConnectFunc();
    if (connectFunc) {
      return this.pluginServiceManagerContainer.pluginManager?.forceConnect(hostInfo, props, false, connectFunc);
    }
    throw new AwsWrapperError("AwsClient is missing target client connect functions."); // This should not be reached
  }
}
