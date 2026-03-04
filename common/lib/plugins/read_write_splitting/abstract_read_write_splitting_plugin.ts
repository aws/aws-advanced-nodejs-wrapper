/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CanReleaseResources } from "../../can_release_resources";
import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { ClientWrapper } from "../../client_wrapper";
import { PluginService } from "../../plugin_service";
import { HostListProviderService } from "../../host_list_provider_service";
import { HostInfo } from "../../host_info";
import { HostChangeOptions } from "../../host_change_options";
import { OldConnectionSuggestionAction } from "../../old_connection_suggestion_action";
import { Messages } from "../../utils/messages";
import { logger } from "../../../logutils";
import { HostRole } from "../../host_role";
import { SqlMethodUtils } from "../../utils/sql_method_utils";
import { FailoverError } from "../../utils/errors";
import { WrapperProperties } from "../../wrapper_property";
import { convertMsToNanos, getTimeInNanos, logAndThrowError } from "../../utils/utils";
import { CacheItem } from "../../utils/cache_map";

export abstract class AbstractReadWriteSplittingPlugin extends AbstractConnectionPlugin implements CanReleaseResources {
  private static readonly subscribedMethods: Set<string> = new Set(["initHostProvider", "connect", "notifyConnectionChanged", "query"]);

  protected _hostListProviderService: HostListProviderService | undefined;
  protected pluginService: PluginService;
  protected readonly _properties: Map<string, any>;
  protected readerHostInfo?: HostInfo = undefined;
  protected writerHostInfo?: HostInfo = undefined;
  protected isReaderClientFromInternalPool: boolean = false;
  protected isWriterClientFromInternalPool: boolean = false;

  protected writerTargetClient: ClientWrapper | undefined;
  protected readerCacheItem: CacheItem<ClientWrapper>;
  protected readonly readerSelectorStrategy: string = "";

  private _inReadWriteSplit = false;

  protected constructor(pluginService: PluginService, properties: Map<string, any>) {
    super();
    this.pluginService = pluginService;
    this._properties = properties;
    this.readerSelectorStrategy = WrapperProperties.READER_HOST_SELECTOR_STRATEGY.get(properties);
  }

  override getSubscribedMethods(): Set<string> {
    return AbstractReadWriteSplittingPlugin.subscribedMethods;
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

  override async notifyConnectionChanged(changes: Set<HostChangeOptions>): Promise<OldConnectionSuggestionAction> {
    try {
      await this.updateInternalClientInfo();
    } catch (e) {
      // pass
    }
    if (this._inReadWriteSplit) {
      return Promise.resolve(OldConnectionSuggestionAction.PRESERVE);
    }
    return Promise.resolve(OldConnectionSuggestionAction.NO_OPINION);
  }

  async updateInternalClientInfo(): Promise<void> {
    const currentTargetClient = this.pluginService.getCurrentClient().targetClient;
    const currentHost = this.pluginService.getCurrentHostInfo();
    if (currentHost === null || currentTargetClient === null) {
      return;
    }

    if (this.shouldUpdateWriterClient(currentTargetClient, currentHost)) {
      this.setWriterClient(currentTargetClient, currentHost);
    } else if (this.shouldUpdateReaderClient(currentTargetClient, currentHost)) {
      await this.setReaderClient(currentTargetClient, currentHost);
    }
  }

  setWriterClient(writerTargetClient: ClientWrapper | undefined, writerHostInfo: HostInfo): void {
    this.writerTargetClient = writerTargetClient;
    this.writerHostInfo = writerHostInfo;
    logger.debug(Messages.get("ReadWriteSplittingPlugin.setWriterClient", writerHostInfo.hostAndPort));
  }

  async setReaderClient(readerTargetClient: ClientWrapper | undefined, readerHost: HostInfo): Promise<void> {
    await this.closeReaderClientIfIdle();
    this.readerCacheItem = new CacheItem(readerTargetClient, this.getKeepAliveTimeout(this.isReaderClientFromInternalPool));
    this.readerHostInfo = readerHost;
    logger.debug(Messages.get("ReadWriteSplittingPlugin.setReaderClient", readerHost.hostAndPort));
  }

  async switchClientIfRequired(readOnly: boolean) {
    const currentClient = this.pluginService.getCurrentClient();
    if (!(await currentClient.isValid())) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.setReadOnlyOnClosedClient", currentClient.targetClient?.id ?? "undefined client"));
    }

    await this.refreshAndStoreTopology(currentClient.targetClient);

    const currentHost = this.pluginService.getCurrentHostInfo();
    if (currentHost == null) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.unavailableHostInfo"));
    } else if (readOnly) {
      if (!this.pluginService.isInTransaction() && currentHost.role != HostRole.READER) {
        try {
          await this.switchToReaderTargetClient();
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
        await this.switchToWriterTargetClient();
      } catch (error: any) {
        logAndThrowError(Messages.get("ReadWriteSplittingPlugin.errorSwitchingToWriter", error.message));
      }
    }
  }

  override async execute<T>(methodName: string, executeFunc: () => Promise<T>, methodArgs: any): Promise<T> {
    const statement = SqlMethodUtils.parseMethodArgs(methodArgs, this.pluginService.getDriverDialect());
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
    } catch (error: any) {
      if (error instanceof FailoverError) {
        logger.debug(Messages.get("ReadWriteSplittingPlugin.failoverErrorWhileExecutingCommand", methodName));
        await this.closeIdleClients();
      } else {
        logger.debug(Messages.get("ReadWriteSplittingPlugin.errorWhileExecutingCommand", methodName, error.message));
      }

      throw error;
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
        logger.debug(Messages.get("ReadWriteSplittingPlugin.settingCurrentClient", newTargetClient.id, newClientHost.hostAndPort));
      } catch (error) {
        // pass
      }
    }
  }

  async switchToWriterTargetClient() {
    const currentHost = this.pluginService.getCurrentHostInfo();
    const currentClient = this.pluginService.getCurrentClient();
    if (this.isWriter(currentHost) && (await this.isTargetClientUsable(currentClient.targetClient))) {
      // Already connected to writer.
      return;
    }
    this._inReadWriteSplit = true;
    if (!(await this.isTargetClientUsable(this.writerTargetClient))) {
      await this.initializeWriterClient();
    } else {
      await this.switchCurrentTargetClientTo(this.writerTargetClient, this.writerHostInfo);
    }

    if (this.isReaderClientFromInternalPool) {
      await this.closeReaderClientIfIdle();
    }

    logger.debug(Messages.get("ReadWriteSplittingPlugin.switchedFromReaderToWriter", this.writerHostInfo.hostAndPort));
  }

  async switchToReaderTargetClient() {
    const currentHost = this.pluginService.getCurrentHostInfo();
    const currentClient = this.pluginService.getCurrentClient();
    if (currentHost !== null && currentHost?.role === HostRole.READER && currentClient) {
      // Already connected to reader.
      return;
    }

    await this.closeReaderIfNecessary();

    this._inReadWriteSplit = true;
    if (this.readerCacheItem == null || !(await this.isTargetClientUsable(this.readerCacheItem.get()))) {
      await this.initializeReaderClient();
    } else {
      try {
        await this.switchCurrentTargetClientTo(this.readerCacheItem.get(), this.readerHostInfo);
        logger.debug(Messages.get("ReadWriteSplittingPlugin.switchedFromWriterToReader", this.readerHostInfo.hostAndPort));
      } catch (error: any) {
        logger.debug(Messages.get("ReadWriteSplittingPlugin.errorSwitchingToCachedReader", this.readerHostInfo.hostAndPort, error.message));
        await this.closeReaderClientIfIdle();
        await this.initializeReaderClient();
      }
    }
    if (this.isWriterClientFromInternalPool) {
      await this.closeWriterClientIfIdle();
    }
  }

  async isTargetClientUsable(targetClient: ClientWrapper | undefined): Promise<boolean> {
    if (!targetClient) {
      return Promise.resolve(false);
    }
    return await this.pluginService.isClientValid(targetClient);
  }

  async closeWriterClientIfIdle() {
    const currentTargetClient = this.pluginService.getCurrentClient().targetClient;
    if (this.writerTargetClient == null || this.writerTargetClient === currentTargetClient) {
      return;
    }

    try {
      await this.pluginService.abortTargetClient(this.writerTargetClient);
    } catch (error) {
      // ignore
    }
    this.writerTargetClient = undefined;
  }

  async closeReaderClientIfIdle(): Promise<void> {
    const currentTargetClient = this.pluginService.getCurrentClient().targetClient;
    const readerClient = this.readerCacheItem?.get(true);
    if (readerClient == null || readerClient === currentTargetClient) {
      return;
    }

    try {
      await this.pluginService.abortTargetClient(readerClient);
    } catch (error) {
      // ignore
    }
    this.readerCacheItem = null;
    this.readerHostInfo = undefined;
  }

  async closeIdleClients() {
    logger.debug(Messages.get("ReadWriteSplittingPlugin.closingInternalClients"));
    await this.closeReaderClientIfIdle();
    await this.closeWriterClientIfIdle();
  }

  protected getKeepAliveTimeout(isPooledClient: boolean): bigint {
    if (isPooledClient) {
      return BigInt(0);
    }
    const keepAliveMs = WrapperProperties.CACHED_READER_KEEP_ALIVE_TIMEOUT.get(this._properties);

    return keepAliveMs > 0 ? getTimeInNanos() + convertMsToNanos(keepAliveMs) : BigInt(0);
  }

  async releaseResources() {
    await this.closeIdleClients();
  }

  protected abstract shouldUpdateReaderClient(currentClient: ClientWrapper | undefined, host: HostInfo): boolean;
  protected abstract shouldUpdateWriterClient(currentClient: ClientWrapper | undefined, host: HostInfo): boolean;
  protected abstract isWriter(currentHost: HostInfo): boolean;
  protected abstract isReader(currentHost: HostInfo): boolean;
  protected abstract refreshAndStoreTopology(currentClient: ClientWrapper | undefined): Promise<void>;
  protected abstract initializeWriterClient(): Promise<void>;
  protected abstract initializeReaderClient(): Promise<void>;
  protected abstract closeReaderIfNecessary(): Promise<void>;
}
