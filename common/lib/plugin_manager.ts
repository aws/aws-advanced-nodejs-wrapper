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
import { AwsWrapperError } from "./utils/aws_wrapper_error";
import { Messages } from "./utils/messages";
import { PluginServiceManagerContainer } from "./plugin_service_manager_container";
import { HostListProviderService } from "./host_list_provider_service";
import { AwsClient } from "./aws_client";
import { PluginService } from "./plugin_service";
import { HostChangeOptions } from "./host_change_options";
import { OldConnectionSuggestionAction } from "./old_connection_suggestion_action";

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
  private static readonly ALL_METHODS = "*";
  private static readonly NOTIFY_HOST_LIST_CHANGED_METHOD = "notifyHostListChanged";
  private static readonly NOTIFY_CONNECTION_CHANGED_METHOD = "notifyConnectionChanged";
  private readonly _plugins: ConnectionPlugin[] = [];
  private pluginServiceManagerContainer: PluginServiceManagerContainer;
  private props: Map<string, any>;

  constructor(pluginServiceManagerContainer: PluginServiceManagerContainer, props: Map<string, any>) {
    this.pluginServiceManagerContainer = pluginServiceManagerContainer;
    this.pluginServiceManagerContainer.pluginManager = this;
    this.props = props;
    if (this.pluginServiceManagerContainer.pluginService != null) {
      this._plugins = new ConnectionPluginChainBuilder().getPlugins(this.pluginServiceManagerContainer.pluginService, props);
    }

    // TODO: proper parsing logic
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

  // TODO: change function so the target client is not altered here.
  async createTargetClientAndConnect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    currentClient: AwsClient,
    forceConnect: boolean
  ): Promise<AwsClient> {
    const currentTargetClient = currentClient.targetClient;
    const createClientFunc = currentClient.getCreateClientFunc();
    const connectFunc = currentClient.getConnectFunc();
    if (createClientFunc && connectFunc) {
      try {
        props.set("host", hostInfo?.host);
        const newTargetClient = createClientFunc(Object.fromEntries(props)) as AwsClient;
        currentClient.targetClient = newTargetClient;
        if (forceConnect) {
          await this.forceConnect(hostInfo, props, false, connectFunc);
        } else {
          await this.connect(hostInfo, props, false, connectFunc);
        }
        currentTargetClient.end();
        return currentClient;
      } catch (error) {
        currentClient.targetClient = currentTargetClient;
        throw new AwsWrapperError(Messages.get("PluginManager.failedToConnectWithNewTargetClient", hostInfo?.host ?? "Undefined"));
      }
    } else {
      currentClient.targetClient = currentTargetClient;
      throw new AwsWrapperError("AwsClient is missing create target client or target client connect functions."); // This should not be reached
    }
  }

  connect<T>(hostInfo: HostInfo | null, props: Map<string, any>, isInitialConnection: boolean, methodFunc: () => Promise<T>): Promise<T> {
    if (hostInfo == null) {
      throw new AwsWrapperError("HostInfo was not provided.");
    }
    return this.executeWithSubscribedPlugins(
      hostInfo,
      props,
      "connect",
      (plugin, nextPluginFunc) => plugin.connect(hostInfo, props, isInitialConnection, nextPluginFunc),
      methodFunc
    );
  }

  forceConnect<T>(hostInfo: HostInfo | null, props: Map<string, any>, isInitialConnection: boolean, methodFunc: () => Promise<T>): Promise<T> {
    if (hostInfo == null) {
      throw new AwsWrapperError("HostInfo was not provided.");
    }
    return this.executeWithSubscribedPlugins(
      hostInfo,
      props,
      "connect",
      (plugin, nextPluginFunc) => plugin.connect(hostInfo, props, isInitialConnection, nextPluginFunc),
      methodFunc
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

  protected notifySubscribedPlugins(methodName: string, pluginFunc: PluginFunc<void>, skipNotificationForThisPlugin: ConnectionPlugin | null): void {
    if (pluginFunc == null) {
      throw new AwsWrapperError("pluginFunc not found.");
    }
    for (let i = 0; i < this._plugins.length; i++) {
      const plugin = this._plugins[i];
      if (plugin == skipNotificationForThisPlugin) {
        continue;
      }
      if (plugin.getSubscribedMethods().has(PluginManager.ALL_METHODS) || plugin.getSubscribedMethods().has(methodName)) {
        pluginFunc(plugin, () => Promise.resolve());
      }
    }
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

  notifyConnectionChanged(changes: Set<HostChangeOptions>, skipNotificationForThisPlugin: ConnectionPlugin) {
    const result = new Set<OldConnectionSuggestionAction>();

    this.notifySubscribedPlugins(
      PluginManager.NOTIFY_CONNECTION_CHANGED_METHOD,
      (plugin, func) => {
        const pluginOpinion: OldConnectionSuggestionAction = plugin.notifyConnectionChanged(changes);
        result.add(pluginOpinion);
        return Promise.resolve();
      },
      skipNotificationForThisPlugin
    );
  }

  notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): void {
    this.notifySubscribedPlugins(
      PluginManager.NOTIFY_HOST_LIST_CHANGED_METHOD,
      (plugin, func) => {
        plugin.notifyHostListChanged(changes);
        return Promise.resolve();
      },
      null
    );
  }
}
