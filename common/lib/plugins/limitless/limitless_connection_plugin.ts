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

import { PluginService } from "../../plugin_service";
import { HostInfo } from "../../host_info";
import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { ClientWrapper } from "../../client_wrapper";
import { LimitlessRouterService, LimitlessRouterServiceImpl } from "./limitless_router_service";
import { Messages } from "../../utils/messages";
import { AwsWrapperError } from "../../utils/errors";
import { LimitlessConnectionContext } from "./limitless_connection_context";
import { LimitlessHelper } from "./limitless_helper";

export class LimitlessConnectionPlugin extends AbstractConnectionPlugin {
  private static readonly subscribedMethods: Set<string> = new Set(["connect"]);
  private static readonly internalConnectPropertyName: string = "784dd5c2-a77b-4c9f-a0a9-b4ea37395e6c";
  private readonly properties: Map<string, any>;
  private readonly pluginService: PluginService;
  private limitlessRouterService: LimitlessRouterService;

  constructor(pluginService: PluginService, properties: Map<string, any>, limitlessRouterService?: LimitlessRouterService) {
    super();
    this.pluginService = pluginService;
    this.properties = properties;
    this.limitlessRouterService = limitlessRouterService ?? new LimitlessRouterServiceImpl(pluginService);
  }

  getSubscribedMethods(): Set<string> {
    return LimitlessConnectionPlugin.subscribedMethods;
  }

  connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    if (props.get(LimitlessConnectionPlugin.internalConnectPropertyName)) {
      return connectFunc();
    }

    const copyProps = new Map<string, any>(props);
    copyProps.set(LimitlessConnectionPlugin.internalConnectPropertyName, true);
    return this.connectInternal(hostInfo, copyProps, isInitialConnection, connectFunc);
  }

  private async connectInternal(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    let conn: ClientWrapper | null;
    const dialect = this.pluginService.getDialect();
    if (!LimitlessHelper.isLimitlessDatabaseDialect(dialect)) {
      conn = await connectFunc();
      const refreshedDialect = this.pluginService.getDialect();
      if (!LimitlessHelper.isLimitlessDatabaseDialect(refreshedDialect)) {
        throw new AwsWrapperError(Messages.get("LimitlessConnectionPlugin.unsupportedDialectOrDatabase", refreshedDialect.getDialectName()));
      }
    }

    if (isInitialConnection) {
      this.limitlessRouterService.startMonitor(hostInfo, props);
    }

    const context = new LimitlessConnectionContext(hostInfo, props, conn, connectFunc, null);
    await this.limitlessRouterService.establishConnection(context);

    if (context.getConnection() != null) {
      return context.getConnection();
    }
    throw new AwsWrapperError(Messages.get("LimitlessConnectionPlugin.failedToConnectToHost", hostInfo.host));
  }
}
