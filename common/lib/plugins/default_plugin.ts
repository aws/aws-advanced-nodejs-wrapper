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
import { PluginService } from "../plugin_service";
import { ConnectionProvider } from "../connection_provider";
import { HostAvailability } from "../host_availability/host_availability";
import { ClientWrapper } from "../client_wrapper";
import { TelemetryTraceLevel } from "../utils/telemetry/telemetry_trace_level";

export class DefaultPlugin extends AbstractConnectionPlugin {
  id: string = uniqueId("_defaultPlugin");
  private readonly pluginService: PluginService;

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;
  }

  override getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);  // TODO verify Subscribed Methods
  }

  override async forceConnect<Type>(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return await this.connectInternal(hostInfo, props, this.pluginService.getConnectionProvider(hostInfo, props));
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
    return await this.connectInternal(hostInfo, props, this.pluginService.getConnectionProvider(hostInfo, props));
  }

  private async connectInternal(hostInfo: HostInfo, props: Map<string, any>, connProvider: ConnectionProvider): Promise<ClientWrapper> {
    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(
      `${this.pluginService.getDriverDialect().getDialectName()} - connect`,
      TelemetryTraceLevel.NESTED
    );

    const result = await telemetryContext.start(async () => await connProvider.connect(hostInfo, this.pluginService, props));
    this.pluginService.setAvailability(hostInfo.allAliases, HostAvailability.AVAILABLE);
    await this.pluginService.updateDialect(result);
    return result;
  }

  override async execute<Type>(methodName: string, methodFunc: () => Promise<Type>): Promise<Type> {
    logger.debug(Messages.get("DefaultPlugin.executingMethod", methodName));

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(
      `${this.pluginService.getDriverDialect().getDialectName()} - ${methodName}`,
      TelemetryTraceLevel.NESTED
    );

    return await telemetryContext.start(async () => await methodFunc());
  }

  override notifyConnectionChanged(changes: Set<HostChangeOptions>): Promise<OldConnectionSuggestionAction> {
    return Promise.resolve(OldConnectionSuggestionAction.NO_OPINION);
  }

  override notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): Promise<void> {
    return Promise.resolve();
  }
}
