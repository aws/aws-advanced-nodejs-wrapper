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
import { uniqueId } from "lodash";
import { logger } from "../../../logutils";
import { performance } from "perf_hooks";
import { HostInfo } from "../../host_info";
import { AwsClient } from "../../aws_client";
import { OldConnectionSuggestionAction } from "../../old_connection_suggestion_action";
import { ConnectionPluginFactory } from "../../plugin_factory";
import { PluginService } from "../../plugin_service";
import { ConnectionPlugin } from "../../connection_plugin";
import { HostListProviderService } from "../../host_list_provider_service";
import { ClusterAwareReaderFailoverHandler } from "./reader_failover_handler";
import { SubscribedMethodHelper } from "../../utils/subsribed_method_helper";
import { HostChangeOptions } from "../../host_change_options";
import { ClusterAwareWriterFailoverHandler } from "./writer_failover_handler";
import { Messages } from "../../utils/messages";

export class FailoverPlugin extends AbstractConnectionPlugin {
  private static readonly subscribedMethods: Set<string> = new Set([
    "initHostProvider",
    "connect",
    "forceConnect",
    "query",
    "notifyConnectionChanged",
    "notifyNodeListChanged"
  ]);
  id: string = uniqueId("_failoverPlugin");
  readerFailoverHandler: ClusterAwareReaderFailoverHandler;
  writerFailoverHandler: ClusterAwareWriterFailoverHandler;

  private hostListProviderService?: HostListProviderService;
  private pluginService: PluginService;
  protected enableFailoverSetting?: boolean;

  constructor(pluginService: PluginService, properties: Map<string, any>) {
    super();
    this.pluginService = pluginService;
    logger.debug(`TestPlugin constructor id: ${this.id}`);
    this.readerFailoverHandler = new ClusterAwareReaderFailoverHandler(pluginService, properties, 10000, 10000, true);
    this.writerFailoverHandler = new ClusterAwareWriterFailoverHandler(pluginService, this.readerFailoverHandler, properties, 60000, 5000, 5000);
  }

  override getSubscribedMethods(): Set<string> {
    return FailoverPlugin.subscribedMethods;
  }

  override initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ) {
    this.hostListProviderService = hostListProviderService;
    if (!this.enableFailoverSetting) {
      return;
    }

    initHostProviderFunc();
  }

  override notifyConnectionChanged(changes: Set<HostChangeOptions>): OldConnectionSuggestionAction {
    throw new Error("Method not implemented.");
  }

  override notifyNodeListChanged(changes: Map<string, Set<HostChangeOptions>>): void {}

  override connect<Type>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Type): Type {
    logger.debug(`Start connect for test plugin: ${this.id}`);
    try {
      return connectFunc();
    } catch (e) {
      logger.debug(e);
      throw e;
    }
  }

  override forceConnect<Type>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Type): Type {
    throw new Error("Method not implemented.");
  }

  connectInternal(connectFunc: () => void) {}

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>): Promise<T> {
    try {
      const start = performance.now();
      if (this.canUpdateTopology(methodName)) {
        await this.updateTopology(false);
      }
      const res = methodFunc();
      logger.debug(Messages.get("ExecutionTimePlugin.executionTime", this.id, (performance.now() - start).toString()));
      return res;
    } catch (e) {
      logger.debug(e);
      throw e;
    }
  }

  failover(failedHost: HostInfo) {}

  async failoverReader(failedHost: HostInfo) {
    // TODO: get failed hosts if parameter is null
    return await this.readerFailoverHandler.failover(this.pluginService.getHosts(), failedHost);
  }

  async failoverWriter() {
    return await this.writerFailoverHandler.failover(this.pluginService.getHosts());
  }

  pickNewConnection() {}

  transferSessionState(src: AwsClient, srcHostInfo: HostInfo, dest: AwsClient, destHostInfo: HostInfo) {}

  protected async updateTopology(forceUpdate: boolean) {
    const client = this.pluginService.getCurrentClient();
    if (!client || !client.isValid()) {
      return;
    }

    if (forceUpdate) {
      await this.pluginService.forceRefreshHostList();
    } else {
      await this.pluginService.refreshHostList();
    }
  }

  private canUpdateTopology(methodName: string) {
    return SubscribedMethodHelper.METHODS_REQUIRING_UPDATED_TOPOLOGY.indexOf(methodName) > -1;
  }
}

export class FailoverPluginFactory implements ConnectionPluginFactory {
  getInstance(pluginService: PluginService, properties: Map<string, any>): ConnectionPlugin {
    return new FailoverPlugin(pluginService, properties);
  }
}
