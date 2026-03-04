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

import { HostInfo, HostRole } from "../../index";
import { PluginService } from "../../plugin_service";
import { HostListProviderService } from "../../host_list_provider_service";
import { Messages } from "../../utils/messages";
import { ClientWrapper } from "../../client_wrapper";
import { containsHostAndPort, getWriter, logAndThrowError, logTopology } from "../../utils/utils";
import { AbstractReadWriteSplittingPlugin } from "./abstract_read_write_splitting_plugin";
import { WrapperProperties } from "../../wrapper_property";
import { logger } from "../../../logutils";
import { CacheItem } from "../../utils/cache_map";

export class ReadWriteSplittingPlugin extends AbstractReadWriteSplittingPlugin {
  protected hosts: HostInfo[] = [];

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
    super(pluginService, properties);
    this._hostListProviderService = hostListProviderService;
    this.writerTargetClient = writerClient;
    this.readerCacheItem = new CacheItem(readerClient, BigInt(0));
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

  protected isWriter(currentHost: HostInfo): boolean {
    return HostRole.WRITER === currentHost.role;
  }

  protected isReader(currentHost: HostInfo): boolean {
    return HostRole.READER === currentHost.role;
  }

  protected async refreshAndStoreTopology(currentClient: ClientWrapper | undefined): Promise<void> {
    if (await this.pluginService.isClientValid(currentClient)) {
      try {
        await this.pluginService.refreshHostList();
      } catch {
        // pass
      }
    }

    this.hosts = this.pluginService.getHosts();
    if (this.hosts == null || this.hosts.length === 0) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.emptyHostList"));
    }

    this.writerHostInfo = getWriter(this.hosts, Messages.get("ReadWriteSplittingPlugin.noWriterFound"));
  }

  protected async forceRefreshAndStoreTopology(currentClient: ClientWrapper | undefined): Promise<void> {
    if (await this.pluginService.isClientValid(currentClient)) {
      try {
        await this.pluginService.forceRefreshHostList();
      } catch {
        // ignore
      }
    }

    this.hosts = this.pluginService.getHosts();
    if (this.hosts == null || this.hosts.length === 0) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.emptyHostList"));
    }

    this.writerHostInfo = getWriter(this.hosts, Messages.get("ReadWriteSplittingPlugin.noWriterFound"));
  }

  override async initializeWriterClient(): Promise<void> {
    let client: ClientWrapper = await this.connectToWriter();

    if (!this.isWriter(client.hostInfo)) {
      // refresh and store topology updates this.writerHostInfo.
      await this.forceRefreshAndStoreTopology(client);

      if (client !== this.readerCacheItem.get() && client !== this.pluginService.getCurrentClient().targetClient) {
        try {
          await client.end();
        } catch (error) {
          // Ignore
        }
      }

      client = await this.connectToWriter();
    }
    this.isWriterClientFromInternalPool = this.pluginService.isPooledClient();
    this.setWriterClient(client, this.writerHostInfo);
    await this.switchCurrentTargetClientTo(this.writerTargetClient, this.writerHostInfo);
  }

  private async connectToWriter() {
    const copyProps = new Map(this._properties);
    copyProps.set(WrapperProperties.HOST.name, this.writerHostInfo.host);
    return await this.pluginService.connect(this.writerHostInfo, copyProps, this);
  }

  override async initializeReaderClient() {
    if (this.hosts.length === 1) {
      if (!(await this.isTargetClientUsable(this.writerTargetClient))) {
        await this.initializeWriterClient();
      }
      logger.warn(Messages.get("ReadWriteSplittingPlugin.noReadersFound", this.writerHostInfo.hostAndPort));
    } else {
      await this.getNewReaderClient();
      logger.debug(Messages.get("ReadWriteSplittingPlugin.switchedFromWriterToReader", this.readerHostInfo.hostAndPort));
    }
  }

  override shouldUpdateReaderClient(currentClient: ClientWrapper | undefined, host: HostInfo): boolean {
    return this.isReader(host);
  }

  override shouldUpdateWriterClient(currentClient: ClientWrapper | undefined, host: HostInfo): boolean {
    return this.isWriter(host);
  }

  protected async getNewReaderClient() {
    let targetClient = undefined;
    let readerHost: HostInfo | undefined = undefined;

    const hostCandidates: HostInfo[] = this.getReaderHostCandidates();

    const connectAttempts = hostCandidates.length * 2;

    for (let i = 0; i < connectAttempts; i++) {
      const host = this.pluginService.getHostInfoByStrategy(HostRole.READER, this.readerSelectorStrategy);
      if (host) {
        try {
          const copyProps = new Map<string, any>(this._properties);
          copyProps.set(WrapperProperties.HOST.name, host.host);
          targetClient = await this.pluginService.connect(host, copyProps, this);
          this.isReaderClientFromInternalPool = this.pluginService.isPooledClient();
          readerHost = host;
          break;
        } catch (any) {
          logger.warn(Messages.get("ReadWriteSplittingPlugin.failedToConnectToReader", host.hostAndPort));
        }
      }
    }
    if (targetClient == undefined || readerHost === undefined) {
      logAndThrowError(Messages.get("ReadWriteSplittingPlugin.noReadersAvailable"));
      return;
    }
    logger.debug(Messages.get("ReadWriteSplittingPlugin.successfullyConnectedToReader", readerHost.hostAndPort));
    await this.setReaderClient(targetClient, readerHost);
    await this.switchCurrentTargetClientTo(this.readerCacheItem.get(), this.readerHostInfo);
  }

  protected async closeReaderIfNecessary(): Promise<void> {
    if (this.readerHostInfo != null && !containsHostAndPort(this.hosts, this.readerHostInfo.hostAndPort)) {
      logger.debug(Messages.get("ReadWriteSplittingPlugin.previousReaderNotAllowed", this.readerHostInfo.toString(), logTopology(this.hosts, "")));
      await this.closeReaderClientIfIdle();
    }
  }

  protected getReaderHostCandidates(): HostInfo[] | undefined {
    return this.pluginService.getHosts();
  }
}
