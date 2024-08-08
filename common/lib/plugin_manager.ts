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

import { ConnectionPlugin } from "./connection_plugin";
import { HostInfo } from "./host_info";
import { ConnectionPluginChainBuilder } from "./connection_plugin_chain_builder";
import { AwsWrapperError } from "./utils/errors";
import { Messages } from "./utils/messages";
import { PluginServiceManagerContainer } from "./plugin_service_manager_container";
import { HostListProviderService } from "./host_list_provider_service";
import { HostChangeOptions } from "./host_change_options";
import { OldConnectionSuggestionAction } from "./old_connection_suggestion_action";
import { HostRole } from "./host_role";
import { ConnectionProvider } from "./connection_provider";
import { ClientWrapper } from "./client_wrapper";
import { CanReleaseResources } from "./can_release_resources";

type PluginFunc<T> = (plugin: ConnectionPlugin, targetFunc: () => Promise<T>) => Promise<T>;

class PluginChain<T> {
  private readonly targetFunc: () => Promise<T>;
  private chain?: (pluginFunc: PluginFunc<T>, targetFunc: () => Promise<T>) => Promise<T>;
  private readonly name: string;
  private readonly hostInfo;
  private readonly props;

  constructor(hostInfo: HostInfo, props: Map<string, any>, name: string, targetFunc: () => Promise<T>) {
    this.targetFunc = targetFunc;
    this.name = name;
    this.hostInfo = hostInfo;
    this.props = props;
  }

  addToHead(plugin: ConnectionPlugin) {
    if (this.chain === undefined) {
      this.chain = (pluginFunc, targetFunc) => pluginFunc(plugin, targetFunc);
    } else {
      const pipelineSoFar = this.chain;
      // @ts-ignore
      this.chain = (pluginFunc, targetFunc) => pluginFunc(plugin, () => pipelineSoFar(pluginFunc, targetFunc));
    }
    return this;
  }

  execute(pluginFunc: PluginFunc<T>): Promise<T> {
    if (this.chain === undefined) {
      throw new AwsWrapperError(Messages.get("PluginManager.PipelineNone"));
    }
    return this.chain(pluginFunc, this.targetFunc);
  }
}

export class PluginManager {
  private static readonly PLUGIN_CHAIN_CACHE = new Map<[string, HostInfo], PluginChain<any>>();
  private static readonly ALL_METHODS: string = "*";
  private static readonly CONNECT_METHOD = "connect";
  private static readonly FORCE_CONNECT_METHOD = "forceConnect";
  private static readonly NOTIFY_HOST_LIST_CHANGED_METHOD: string = "notifyHostListChanged";
  private static readonly NOTIFY_CONNECTION_CHANGED_METHOD: string = "notifyConnectionChanged";
  private static readonly ACCEPTS_STRATEGY_METHOD: string = "acceptsStrategy";
  private static readonly GET_HOST_INFO_BY_STRATEGY_METHOD: string = "getHostInfoByStrategy";
  private readonly defaultConnProvider;
  private readonly effectiveConnProvider;
  private readonly props: Map<string, any>;
  private _plugins: ConnectionPlugin[] = [];
  private pluginServiceManagerContainer: PluginServiceManagerContainer;

  constructor(
    pluginServiceManagerContainer: PluginServiceManagerContainer,
    props: Map<string, any>,
    defaultConnProvider: ConnectionProvider,
    effectiveConnProvider: ConnectionProvider | null
  ) {
    this.pluginServiceManagerContainer = pluginServiceManagerContainer;
    this.pluginServiceManagerContainer.pluginManager = this;
    this.props = props;
    this.defaultConnProvider = defaultConnProvider;
    this.effectiveConnProvider = effectiveConnProvider;

    // TODO: proper parsing logic
  }

  async init() {
    if (this.pluginServiceManagerContainer.pluginService != null) {
      this._plugins = await ConnectionPluginChainBuilder.getPlugins(
        this.pluginServiceManagerContainer.pluginService,
        this.props,
        this.defaultConnProvider,
        this.effectiveConnProvider
      );
    }
  }

  execute<T>(hostInfo: HostInfo | null, props: Map<string, any>, methodName: string, methodFunc: () => Promise<T>, options: any): Promise<T> {
    if (hostInfo == null) {
      throw new AwsWrapperError("No host");
    }
    return this.executeWithSubscribedPlugins(
      hostInfo,
      props,
      methodName,
      (plugin, nextPluginFunc) => plugin.execute(methodName, nextPluginFunc, options),
      methodFunc
    );
  }

  connect<T>(hostInfo: HostInfo | null, props: Map<string, any>, isInitialConnection: boolean): Promise<ClientWrapper> {
    if (hostInfo == null) {
      throw new AwsWrapperError("HostInfo was not provided.");
    }
    return this.executeWithSubscribedPlugins<ClientWrapper>(
      hostInfo,
      props,
      PluginManager.CONNECT_METHOD,
      (plugin, nextPluginFunc) => plugin.connect(hostInfo, props, isInitialConnection, nextPluginFunc),
      async () => {
        throw new AwsWrapperError("Shouldn't be called.");
      }
    );
  }

  forceConnect<T>(hostInfo: HostInfo | null, props: Map<string, any>, isInitialConnection: boolean): Promise<ClientWrapper> {
    if (hostInfo == null) {
      throw new AwsWrapperError("HostInfo was not provided.");
    }
    return this.executeWithSubscribedPlugins<ClientWrapper>(
      hostInfo,
      props,
      PluginManager.FORCE_CONNECT_METHOD,
      (plugin, nextPluginFunc) => plugin.forceConnect(hostInfo, props, isInitialConnection, nextPluginFunc),
      async () => {
        throw new AwsWrapperError("Shouldn't be called.");
      }
    );
  }

  executeWithSubscribedPlugins<T>(
    hostInfo: HostInfo,
    props: Map<string, any>,
    methodName: string,
    pluginFunc: PluginFunc<T>,
    methodFunc: () => Promise<T>
  ): Promise<T> {
    let chain = PluginManager.PLUGIN_CHAIN_CACHE.get([methodName, hostInfo]);
    if (!chain) {
      chain = this.make_execute_pipeline(hostInfo, props, methodName, methodFunc);
      PluginManager.PLUGIN_CHAIN_CACHE.set([methodName, hostInfo], chain);
    }
    return chain.execute(pluginFunc);
  }

  make_execute_pipeline<T>(hostInfo: HostInfo, props: Map<string, any>, name: string, methodFunc: () => Promise<T>): PluginChain<T> {
    const chain = new PluginChain(hostInfo, props, name, methodFunc);

    for (let i = this._plugins.length - 1; i >= 0; i--) {
      const p = this._plugins[i];
      if (p.getSubscribedMethods().has("*") || p.getSubscribedMethods().has(name)) {
        chain.addToHead(p);
      }
    }

    return chain;
  }

  async initHostProvider(hostInfo: HostInfo, props: Map<string, any>, hostListProviderService: HostListProviderService): Promise<void> {
    return await this.executeWithSubscribedPlugins(
      hostInfo,
      props,
      "initHostProvider",
      (plugin, nextPluginFunc) => Promise.resolve(plugin.initHostProvider(hostInfo, props, hostListProviderService, nextPluginFunc)),
      () => {
        throw new AwsWrapperError("Shouldn't be called");
      }
    );
  }

  protected async notifySubscribedPlugins(
    methodName: string,
    pluginFunc: PluginFunc<void>,
    skipNotificationForThisPlugin: ConnectionPlugin | null
  ): Promise<void> {
    if (pluginFunc === null) {
      throw new AwsWrapperError("pluginFunc not found.");
    }
    for (const plugin of this._plugins) {
      if (plugin === skipNotificationForThisPlugin) {
        continue;
      }
      if (plugin.getSubscribedMethods().has(PluginManager.ALL_METHODS) || plugin.getSubscribedMethods().has(methodName)) {
        await pluginFunc(plugin, () => Promise.resolve());
      }
    }
  }

  async notifyConnectionChanged(
    changes: Set<HostChangeOptions>,
    skipNotificationForThisPlugin: ConnectionPlugin | null
  ): Promise<Set<OldConnectionSuggestionAction>> {
    const result = new Set<OldConnectionSuggestionAction>();
    await this.notifySubscribedPlugins(
      PluginManager.NOTIFY_CONNECTION_CHANGED_METHOD,
      async (plugin) => {
        result.add(await plugin.notifyConnectionChanged(changes));
        return Promise.resolve();
      },
      skipNotificationForThisPlugin
    );
    return result;
  }

  async notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): Promise<void> {
    await this.notifySubscribedPlugins(
      PluginManager.NOTIFY_HOST_LIST_CHANGED_METHOD,
      (plugin, func) => {
        plugin.notifyHostListChanged(changes);
        return Promise.resolve();
      },
      null
    );
  }

  acceptsStrategy(role: HostRole, strategy: string) {
    for (const plugin of this._plugins) {
      const pluginSubscribedMethods = plugin.getSubscribedMethods();
      const isSubscribed =
        pluginSubscribedMethods.has(PluginManager.ALL_METHODS) || pluginSubscribedMethods.has(PluginManager.ACCEPTS_STRATEGY_METHOD);

      if (isSubscribed && plugin.acceptsStrategy(role, strategy)) {
        return true;
      }
    }

    return false;
  }

  getHostInfoByStrategy(role: HostRole, strategy: string): HostInfo {
    for (const plugin of this._plugins) {
      const pluginSubscribedMethods = plugin.getSubscribedMethods();
      const isSubscribed =
        pluginSubscribedMethods.has(PluginManager.ALL_METHODS) || pluginSubscribedMethods.has(PluginManager.GET_HOST_INFO_BY_STRATEGY_METHOD);

      if (isSubscribed) {
        try {
          const host = plugin.getHostInfoByStrategy(role, strategy);
          if (host) {
            return host;
          }
        } catch (error) {
          // This plugin does not support the provided strategy, ignore the exception and move on
        }
      }
    }

    throw new AwsWrapperError("The driver does not support the requested host selection strategy: " + strategy);
  }

  async releaseResources() {
    // This step allows all connection plugins a chance to clean up any dangling resources or
    // perform any last tasks before shutting down.

    for (const plugin of this._plugins) {
      if (this.implementsCanReleaseResources(plugin)) {
        await plugin.releaseResources();
      }
    }
  }

  private implementsCanReleaseResources(plugin: any): plugin is CanReleaseResources {
    return plugin.releaseResources !== undefined;
  }
}
