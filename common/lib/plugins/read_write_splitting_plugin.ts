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

import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { HostInfo } from "../host_info";
import { PluginService } from "../plugin_service";
import { HostListProviderService } from "../host_list_provider_service";
import { OldConnectionSuggestionAction } from "../old_connection_suggestion_action";
import { HostChangeOptions } from "../host_change_options";
import { WrapperProperties } from "../wrapper_property";
import { Messages } from "../utils/messages";
import { logger } from "../../logutils";
import { FailoverError } from "../utils/errors";
import { HostRole } from "../host_role";
import { SqlMethodUtils } from "../utils/sql_method_utils";
import { ClientWrapper } from "../client_wrapper";
import { getWriter, logAndThrowError } from "../utils/utils";

export class ReadWriteSplittingPlugin extends AbstractConnectionPlugin {
  private static readonly subscribedMethods: Set<string> = new Set(["initHostProvider", "connect", "notifyConnectionChanged", "query"]);
  private readonly readerSelectorStrategy: string = "";

  private _hostListProviderService: HostListProviderService | undefined;
  private pluginService: PluginService;
  private readonly _properties: Map<string, any>;
  private _readerHostInfo?: HostInfo = undefined;
  private _inReadWriteSplit = false;
  writerTargetClient: ClientWrapper | undefined;
  readerTargetClient: ClientWrapper | undefined;

  constructor(pluginService: PluginService, properties: Map<string, any>);
  constructor(
    pluginService: PluginService,
    properties: Map<string, any>,
    hostListProviderService: HostListProviderService,
    writerClient: ClientWrapper,
    readerClient: ClientWrapper
  );
  constructor(
    pluginService: PluginService,
    properties: Map<string, any>,
    hostListProviderService?: HostListProviderService,
    writerClient?: ClientWrapper,
    readerClient?: ClientWrapper
  ) {
    super();
    this.pluginService = pluginService;
    this._properties = properties;
    this.readerSelectorStrategy = WrapperProperties.READER_HOST_SELECTOR_STRATEGY.get(properties);
    this._hostListProviderService = hostListProviderService;
    this.writerTargetClient = writerClient;
    this.readerTargetClient = readerClient;
  }

  override getSubscribedMethods(): Set<string> {
    return ReadWriteSplittingPlugin.subscribedMethods;
  }

  override initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ) {
    this._hostListProviderService = hostListProviderService;
    initHostProviderFunc();
  }

  override notifyConnectionChanged(changes: Set<HostChangeOptions>): Promise<OldConnectionSuggestionAction> {
    try {
      this.updateInternalClientInfo();
    } catch (e) {
      // pass
    }
    if (this._inReadWriteSplit) {
      return Promise.resolve(OldConnectionSuggestionAction.PRESERVE);
    }
    return Promise.resolve(OldConnectionSuggestionAction.NO_OPINION);
  }

  updateInternalClientInfo(): void {
    const currentTargetClient = this.pluginService.getCurrentClient().targetClient;
    const currentHost = this.pluginService.getCurrentHostInfo();
    if (currentHost === null || currentTargetClient === null) {
      return;
    }

    if (currentHost.role === HostRole.WRITER) {
      this.setWriterClient(currentTargetClient, currentHost);
    } else {
      this.setReaderClient(currentTargetClient, currentHost);
    }
  }

  override async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    if (!this.pluginService.acceptsStrategy(hostInfo.role, this.readerSelectorStrategy)) {
      const message: string = Messages.get("ReadWriteSplittingPlugin.unsupportedHostSelectorStrategy", this.readerSelectorStrategy);
      logAndThrowError(message);
    }
    return await this.connectInternal(isInitialConnection, connectFunc);
  }

  forceConnect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(isInitialConnection, forceConnectFunc);
  }

  private async connectInternal(isInitialConnection: boolean, connectFunc: () => Promise<ClientWrapper>): Promise<ClientWrapper> {
    const result = await connectFunc();
    if (!isInitialConnection || this._hostListProviderService?.isStaticHostListProvider()) {
      return result;
    }
    const currentRole = this.pluginService.getCurrentHostInfo()?.role;

    if (currentRole == HostRole.UNKNOWN) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.errorVerifyingInitialHostRole"));
    }
    const currentHost: HostInfo | null = this.pluginService.getInitialConnectionHostInfo();
    if (currentHost !== null) {
      if (currentRole === currentHost.role) {
        return result;
      }
      const updatedHost: HostInfo = Object.assign({}, currentHost);
      updatedHost.role = currentRole ?? HostRole.UNKNOWN;
      this._hostListProviderService?.setInitialConnectionHostInfo(updatedHost);
    }
    return result;
  }

  override async execute<T>(methodName: string, executeFunc: () => Promise<T>, methodArgs: any): Promise<T> {
    const statement = methodArgs.sql ?? methodArgs;
    const statements = SqlMethodUtils.parseMultiStatementQueries(statement);

    const updateReadOnly: boolean | undefined = SqlMethodUtils.doesSetReadOnly(statements, this.pluginService.getDialect());
    if (updateReadOnly !== undefined) {
      try {
        await this.switchClientIfRequired(updateReadOnly);
      } catch (error) {
        await this.closeIdleClients();
        throw error;
      }
    }

    try {
      return await executeFunc();
    } catch (error) {
      if (error instanceof FailoverError) {
        logger.debug(Messages.get("ReadWriteSplittingPlugin.failoverExceptionWhileExecutingCommand", methodName));
        await this.closeIdleClients();
      } else {
        logger.debug(Messages.get("ReadWriteSplittingPlugin.exceptionWhileExecutingCommand", methodName));
      }

      throw error;
    }
  }

  setWriterClient(writerTargetClient: ClientWrapper | undefined, writerHostInfo: HostInfo): void {
    this.writerTargetClient = writerTargetClient;
    logger.debug(Messages.get("ReadWriteSplittingPlugin.setWriterClient", writerHostInfo.url));
  }

  setReaderClient(readerTargetClient: ClientWrapper | undefined, readerHost: HostInfo): void {
    this.readerTargetClient = readerTargetClient;
    this._readerHostInfo = readerHost;
    logger.debug(Messages.get("ReadWriteSplittingPlugin.setReaderClient", readerHost.url));
  }

  async getNewWriterClient(writerHost: HostInfo) {
    const props = new Map(this._properties);
    props.set(WrapperProperties.HOST.name, writerHost.host);
    try {
      const targetClient = await this.pluginService.connect(writerHost, props);
      this.setWriterClient(targetClient, writerHost);
      await this.switchCurrentTargetClientTo(this.writerTargetClient, writerHost);
    } catch (any) {
      logger.warn(Messages.get("ReadWriteSplittingPlugin.failedToConnectToWriter", writerHost.url));
    }
  }

  async switchClientIfRequired(readOnly: boolean) {
    const currentClient = this.pluginService.getCurrentClient();
    if (!(await currentClient.isValid())) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.setReadOnlyOnClosedClient"));
    }
    try {
      await this.pluginService.refreshHostList();
    } catch {
      // pass
    }

    const hosts: HostInfo[] = this.pluginService.getHosts();
    if (hosts == null || hosts.length === 0) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.emptyHostList"));
    }

    const currentHost = this.pluginService.getCurrentHostInfo();
    if (currentHost == null) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.unavailableHostInfo"));
    } else if (readOnly) {
      if (!this.pluginService.isInTransaction() && currentHost.role != HostRole.READER) {
        try {
          await this.switchToReaderTargetClient(hosts);
        } catch (error: any) {
          if (!(await currentClient.isValid())) {
            logAndThrowError(Messages.get("ReadWriteSplittingPlugin.errorSwitchingToReader", error.message));
          }
          logger.warn(Messages.get("ReadWriteSplittingPlugin.fallbackToWriter", currentHost.url));
        }
      }
    } else if (currentHost.role != HostRole.WRITER) {
      if (this.pluginService.isInTransaction()) {
        logAndThrowError(Messages.get("ReadWriteSplittingPlugin.setReadOnlyFalseInTransaction"));
      }
      try {
        await this.switchToWriterTargetClient(hosts);
      } catch (error: any) {
        logAndThrowError(Messages.get("ReadWriteSplittingPlugin.errorSwitchingToWriter", error.message));
      }
    }
  }

  async switchCurrentTargetClientTo(newTargetClient: ClientWrapper | undefined, newClientHost: HostInfo | undefined) {
    const currentTargetClient = this.pluginService.getCurrentClient().targetClient;

    if (currentTargetClient === newTargetClient) {
      return;
    }
    if (newClientHost && newTargetClient) {
      try {
        await this.pluginService.setCurrentClient(newTargetClient, newClientHost);
        logger.debug(Messages.get("ReadWriteSplittingPlugin.settingCurrentClient", newClientHost.url));
      } catch (error) {
        // pass
      }
    }
  }

  async initializeReaderClient(hosts: HostInfo[]) {
    if (hosts.length === 1) {
      const writerHost = getWriter(hosts, Messages.get("ReadWriteSplittingPlugin.noWriterFound"));
      if (writerHost) {
        if (!(await this.isTargetClientUsable(this.writerTargetClient))) {
          await this.getNewWriterClient(writerHost);
        }
        logger.warn(Messages.get("ReadWriteSplittingPlugin.noReadersFound", writerHost.url));
      }
    } else {
      await this.getNewReaderClient();
    }
  }

  async getNewReaderClient() {
    let targetClient = undefined;
    let readerHost: HostInfo | undefined = undefined;
    const connectAttempts = this.pluginService.getHosts().length;

    for (let i = 0; i < connectAttempts; i++) {
      const host = this.pluginService.getHostInfoByStrategy(HostRole.READER, this.readerSelectorStrategy);
      if (host) {
        const props = new Map(this._properties);
        props.set(WrapperProperties.HOST.name, host.host);

        try {
          targetClient = await this.pluginService.connect(host, props);
          readerHost = host;
          break;
        } catch (any) {
          logger.warn(Messages.get("ReadWriteSplittingPlugin.failedToConnectToReader", host.url));
        }
      }
    }
    if (targetClient == undefined || readerHost === undefined) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.noReadersAvailable"));
      return;
    }
    logger.debug(Messages.get("ReadWriteSplittingPlugin.successfullyConnectedToReader", readerHost.url));
    this.setReaderClient(targetClient, readerHost);
    await this.switchCurrentTargetClientTo(this.readerTargetClient, this._readerHostInfo);
  }

  async switchToWriterTargetClient(hosts: HostInfo[]) {
    const currentHost = this.pluginService.getCurrentHostInfo();
    const currentClient = this.pluginService.getCurrentClient();
    if (currentHost !== null && currentHost?.role === HostRole.WRITER && (await currentClient.isValid())) {
      return;
    }
    this._inReadWriteSplit = true;
    const writerHost = getWriter(hosts, Messages.get("ReadWriteSplittingPlugin.noWriterFound"));
    if (!writerHost) {
      return;
    }
    if (!(await this.isTargetClientUsable(this.writerTargetClient))) {
      await this.getNewWriterClient(writerHost);
    } else if (this.writerTargetClient) {
      await this.switchCurrentTargetClientTo(this.writerTargetClient, writerHost);
    }
    logger.debug(Messages.get("ReadWriteSplittingPlugin.switchedFromReaderToWriter", writerHost.url));
  }

  async switchToReaderTargetClient(hosts: HostInfo[]) {
    const currentHost = this.pluginService.getCurrentHostInfo();
    const currentClient = this.pluginService.getCurrentClient();
    if (currentHost !== null && currentHost?.role === HostRole.READER && currentClient) {
      return;
    }

    this._inReadWriteSplit = true;
    if (!(await this.isTargetClientUsable(this.readerTargetClient))) {
      await this.initializeReaderClient(hosts);
    } else if (this.readerTargetClient != null && this._readerHostInfo != null) {
      try {
        await this.switchCurrentTargetClientTo(this.readerTargetClient, this._readerHostInfo);
        logger.debug(Messages.get("ReadWriteSplittingPlugin.switchedFromWriterToReader", this._readerHostInfo.url));
      } catch (error: any) {
        logger.debug(Messages.get("ReadWriteSplittingPlugin.errorSwitchingToCachedReader", this._readerHostInfo.url));
        await this.pluginService.tryClosingTargetClient(this.readerTargetClient);
        this.readerTargetClient = undefined;
        this._readerHostInfo = undefined;
        await this.initializeReaderClient(hosts);
      }
    }
  }

  async isTargetClientUsable(targetClient: ClientWrapper | undefined): Promise<boolean> {
    if (!targetClient) {
      return Promise.resolve(false);
    }
    return await this.pluginService.isClientValid(targetClient);
  }

  async closeTargetClientIfIdle(internalTargetClient: ClientWrapper | undefined) {
    const currentTargetClient = this.pluginService.getCurrentClient().targetClient;
    try {
      if (internalTargetClient != null && internalTargetClient !== currentTargetClient && (await this.isTargetClientUsable(internalTargetClient))) {
        await this.pluginService.tryClosingTargetClient(internalTargetClient);

        if (internalTargetClient === this.writerTargetClient) {
          this.writerTargetClient = undefined;
        }
        if (internalTargetClient === this.readerTargetClient) {
          this.readerTargetClient = undefined;
          this._readerHostInfo = undefined;
        }
      }
    } catch (error) {
      // ignore
    }
  }

  async closeIdleClients() {
    logger.debug(Messages.get("ReadWriteSplittingPlugin.closingInternalClients"));
    await this.closeTargetClientIfIdle(this.readerTargetClient);
    await this.closeTargetClientIfIdle(this.writerTargetClient);
  }
}
