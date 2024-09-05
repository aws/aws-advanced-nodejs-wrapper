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

import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { HostListProviderService } from "../../host_list_provider_service";
import { PluginService } from "../../plugin_service";
import { StaleDnsHelper } from "./stale_dns_helper";
import { HostInfo } from "../../host_info";
import { HostChangeOptions } from "../../host_change_options";
import { AwsWrapperError } from "../../utils/errors";
import { ClientWrapper } from "../../client_wrapper";

export class StaleDnsPlugin extends AbstractConnectionPlugin {
  private static readonly subscribedMethods: Set<string> = new Set<string>(["initHostProvider", "connect", "forceConnect", "notifyHostListChanged"]);
  private pluginService: PluginService;
  private staleDnsHelper: StaleDnsHelper;
  private hostListProviderService?: HostListProviderService;

  constructor(pluginService: PluginService, properties: Map<string, any>) {
    super();
    this.pluginService = pluginService;
    this.staleDnsHelper = new StaleDnsHelper(this.pluginService);
  }

  getSubscribedMethods(): Set<string> {
    return StaleDnsPlugin.subscribedMethods;
  }

  override async connect<T>(
    hostInfo: HostInfo,
    properties: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    if (!this.hostListProviderService) {
      throw new AwsWrapperError("HostListProviderService not found");
    }
    return await this.staleDnsHelper.getVerifiedConnection(hostInfo.host, isInitialConnection, this.hostListProviderService, properties, connectFunc);
  }

  override async forceConnect<T>(
    hostInfo: HostInfo,
    properties: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    if (!this.hostListProviderService) {
      throw new AwsWrapperError("HostListProviderService not found");
    }
    return await this.staleDnsHelper.getVerifiedConnection(hostInfo.host, isInitialConnection, this.hostListProviderService, properties, connectFunc);
  }

  override initHostProvider(
    hostInfo: HostInfo,
    properties: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    this.hostListProviderService = hostListProviderService;
    initHostProviderFunc();
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    try {
      await this.pluginService.refreshHostList();
    } catch (e) {
      throw new AwsWrapperError("Error refreshing Host List", e);
    }
    return await methodFunc();
  }

  override async notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): Promise<void> {
    await this.staleDnsHelper.notifyHostListChanged(changes);
  }
}
