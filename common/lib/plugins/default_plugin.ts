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

import { uniqueId } from "lodash";
import { logger } from "../../logutils";
import { Messages } from "../utils/messages";
import { HostListProviderService } from "../host_list_provider_service";
import { HostInfo } from "../host_info";
import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { HostChangeOptions } from "../host_change_options";
import { OldConnectionSuggestionAction } from "../old_connection_suggestion_action";
import { HostRole } from "../host_role";
import { PluginService } from "../plugin_service";
import { ConnectionProviderManager } from "../connection_provider_manager";
import { ConnectionProvider } from "../connection_provider";
import { AwsWrapperError } from "../utils/errors";
import { HostAvailability } from "../host_availability/host_availability";
import { ClientWrapper } from "../client_wrapper";

export class DefaultPlugin extends AbstractConnectionPlugin {
  id: string = uniqueId("_defaultPlugin");
  private readonly pluginService: PluginService;
  private readonly connProviderManager: ConnectionProviderManager;
  private readonly effectiveConnProvider: ConnectionProvider | null = null;
  private readonly defaultConnProvider: ConnectionProvider;

  constructor(
    pluginService: PluginService,
    defaultConnProvider: ConnectionProvider,
    effectiveConnProvider: ConnectionProvider | null,
    connectionProviderManager?: ConnectionProviderManager
  ) {
    super();
    this.pluginService = pluginService;
    this.defaultConnProvider = defaultConnProvider;
    this.effectiveConnProvider = effectiveConnProvider;
    if (connectionProviderManager) {
      this.connProviderManager = connectionProviderManager;
    } else {
      this.connProviderManager = new ConnectionProviderManager(defaultConnProvider);
    }
  }

  override getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);
  }

  override async forceConnect<Type>(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return await this.connectInternal(hostInfo, props, this.defaultConnProvider);
  }

  override initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    // do nothing
  }

  override async connect<Type>(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    let connProvider = null;

    if (this.effectiveConnProvider && this.effectiveConnProvider.acceptsUrl(hostInfo, props)) {
      connProvider = this.effectiveConnProvider;
    }

    if (!connProvider) {
      connProvider = this.connProviderManager.getConnectionProvider(hostInfo, props);
    }

    return this.connectInternal(hostInfo, props, connProvider);
  }

  private async connectInternal(hostInfo: HostInfo, props: Map<string, any>, connProvider: ConnectionProvider): Promise<ClientWrapper> {
    const result = await connProvider.connect(hostInfo, this.pluginService, props);
    this.pluginService.setAvailability(hostInfo.allAliases, HostAvailability.AVAILABLE);
    await this.pluginService.updateDialect(result);
    return result;
  }

  override async execute<Type>(methodName: string, methodFunc: () => Promise<Type>): Promise<Type> {
    logger.debug(Messages.get("DefaultPlugin.executingMethod", methodName));
    return await methodFunc();
  }

  override notifyConnectionChanged(changes: Set<HostChangeOptions>): Promise<OldConnectionSuggestionAction> {
    return Promise.resolve(OldConnectionSuggestionAction.NO_OPINION);
  }

  override notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): void {
    // do nothing
  }

  override acceptsStrategy(role: HostRole, strategy: string): boolean {
    if (role === HostRole.UNKNOWN) {
      // Users must request either a writer or a reader role.
      return false;
    }

    if (this.effectiveConnProvider) {
      return this.effectiveConnProvider.acceptsStrategy(role, strategy);
    }
    return this.connProviderManager.acceptsStrategy(role, strategy);
  }

  override getHostInfoByStrategy(role: HostRole, strategy: string): HostInfo {
    if (role === HostRole.UNKNOWN) {
      throw new AwsWrapperError(Messages.get("DefaultConnectionPlugin.unknownRoleRequested"));
    }

    const hosts = this.pluginService.getHosts();
    if (hosts.length < 1) {
      throw new AwsWrapperError(Messages.get("DefaultConnectionPlugin.noHostsAvailable"));
    }

    if (this.effectiveConnProvider) {
      return this.effectiveConnProvider.getHostInfoByStrategy(hosts, role, strategy, this.pluginService.props);
    }

    return this.connProviderManager.getHostInfoByStrategy(hosts, role, strategy, this.pluginService.props);
  }
}
