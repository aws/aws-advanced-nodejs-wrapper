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
import { OldConnectionSuggestionAction } from "../../old_connection_suggestion_action";
import { ConnectionPluginFactory } from "../../plugin_factory";
import { PluginService } from "../../plugin_service";
import { ConnectionPlugin } from "../../connection_plugin";
import { HostListProviderService } from "../../host_list_provider_service";
import { ClusterAwareReaderFailoverHandler } from "./reader_failover_handler";
import { SubscribedMethodHelper } from "../../utils/subscribed_method_helper";
import { HostChangeOptions } from "../../host_change_options";
import { ClusterAwareWriterFailoverHandler } from "./writer_failover_handler";
import { AwsWrapperError, FailoverFailedError, FailoverSuccessError, TransactionResolutionUnknownError } from "../../utils/errors";
import { FailoverMode, failoverModeFromValue } from "./failover_mode";
import { HostRole } from "../../host_role";
import { HostAvailability } from "../../host_availability/host_availability";
import { StaleDnsHelper } from "../stale_dns_helper";
import { WrapperProperties } from "../../wrapper_property";
import { RdsUrlType } from "../../utils/rds_url_type";
import { RdsUtils } from "../../utils/rds_utils";
import { Messages } from "../../utils/messages";

export class FailoverPlugin extends AbstractConnectionPlugin {
  private static readonly METHOD_END = "end";
  private static readonly subscribedMethods: Set<string> = new Set([
    "initHostProvider",
    "connect",
    "forceConnect",
    "query",
    "notifyConnectionChanged",
    "notifyHostListChanged"
  ]);
  private readonly _staleDnsHelper: StaleDnsHelper;
  private readonly _properties: Map<string, any>;
  private readonly _readerFailoverHandler: ClusterAwareReaderFailoverHandler;
  private readonly _writerFailoverHandler: ClusterAwareWriterFailoverHandler;
  private readonly _rdsHelper: RdsUtils;
  private _rdsUrlType: RdsUrlType | null = null;
  private _isInTransaction: boolean = false;
  private _closedExplicitly: boolean = false;
  private _lastError: any;
  protected failoverTimeoutMsSetting: number = WrapperProperties.FAILOVER_TIMEOUT_MS.defaultValue;
  protected failoverClusterTopologyRefreshRateMsSetting: number = WrapperProperties.FAILOVER_CLUSTER_TOPOLOGY_REFRESH_RATE_MS.defaultValue;
  protected failoverWriterReconnectIntervalMsSetting: number = WrapperProperties.FAILOVER_WRITER_RECONNECT_INTERVAL_MS.defaultValue;
  protected failoverReaderConnectTimeoutMsSetting: number = WrapperProperties.FAILOVER_READER_CONNECT_TIMEOUT_MS.defaultValue;
  protected isClosed: boolean = false;
  failoverMode: FailoverMode | null = null;
  id: string = uniqueId("_failoverPlugin");

  private hostListProviderService?: HostListProviderService;
  private pluginService: PluginService;
  protected enableFailoverSetting: boolean = WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.defaultValue;

  constructor(pluginService: PluginService, properties: Map<string, any>, rdsHelper: RdsUtils);
  constructor(
    pluginService: PluginService,
    properties: Map<string, any>,
    rdsHelper: RdsUtils,
    readerFailoverHandler: ClusterAwareReaderFailoverHandler,
    writerFailoverHandler: ClusterAwareWriterFailoverHandler
  );
  constructor(
    pluginService: PluginService,
    properties: Map<string, any>,
    rdsHelper: RdsUtils,
    readerFailoverHandler?: ClusterAwareReaderFailoverHandler,
    writerFailoverHandler?: ClusterAwareWriterFailoverHandler
  ) {
    super();
    logger.debug(`TestPlugin constructor id: ${this.id}`);
    this._properties = properties;
    this.pluginService = pluginService;
    this._rdsHelper = rdsHelper;
    this._readerFailoverHandler = readerFailoverHandler
      ? readerFailoverHandler
      : new ClusterAwareReaderFailoverHandler(
          pluginService,
          properties,
          this.failoverTimeoutMsSetting,
          this.failoverReaderConnectTimeoutMsSetting,
          this.failoverMode === FailoverMode.STRICT_READER
        );
    this._writerFailoverHandler = writerFailoverHandler
      ? writerFailoverHandler
      : new ClusterAwareWriterFailoverHandler(
          pluginService,
          this._readerFailoverHandler,
          properties,
          this.failoverTimeoutMsSetting,
          this.failoverClusterTopologyRefreshRateMsSetting,
          this.failoverWriterReconnectIntervalMsSetting
        );
    this.initSettings();
    this._staleDnsHelper = new StaleDnsHelper(this.pluginService);
  }

  override getSubscribedMethods(): Set<string> {
    return FailoverPlugin.subscribedMethods;
  }

  override initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    this.hostListProviderService = hostListProviderService;
    if (!this.enableFailoverSetting) {
      return;
    }

    initHostProviderFunc();

    this.failoverMode = failoverModeFromValue(WrapperProperties.FAILOVER_MODE.get(this._properties));
    this._rdsUrlType = this._rdsHelper.identifyRdsType(hostInfo.host);

    if (this.failoverMode === FailoverMode.UNKNOWN) {
      this.failoverMode = this._rdsUrlType === RdsUrlType.RDS_READER_CLUSTER ? FailoverMode.READER_OR_WRITER : FailoverMode.STRICT_WRITER;
    }

    logger.debug(Messages.get("Failover.parameterValue", "failoverMode", this.failoverMode.toString()));
  }

  override notifyConnectionChanged(changes: Set<HostChangeOptions>): OldConnectionSuggestionAction {
    return OldConnectionSuggestionAction.NO_OPINION;
  }

  override notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): void {
    if (!this.enableFailoverSetting) {
      return;
    }

    // Log changes
    if (logger.level === "debug") {
      let str = "Changes:";
      for (const [key, values] of changes.entries()) {
        str = str.concat("\n");
        // Convert from int back into enum
        const valStr = Array.from(values)
          .map((x) => HostChangeOptions[x])
          .join(", ");
        str = str.concat(`\tHost '${key}': ${valStr}`);
      }
      logger.debug(str);
    }

    const currentHost = this.pluginService.getCurrentHostInfo();
    if (currentHost) {
      const url = currentHost.url;
      if (this.isHostStillValid(url, changes)) {
        return;
      }

      for (const alias of currentHost.allAliases) {
        if (this.isHostStillValid(alias + "/", changes)) {
          return;
        }
      }
    }
    logger.info(Messages.get("Failover.invalidNode"), currentHost);
  }

  private isHostStillValid(host: string, changes: Map<string, Set<HostChangeOptions>>): boolean {
    if (changes.has(host)) {
      const options = changes.get(host);
      if (options) {
        return !options.has(HostChangeOptions.HOST_DELETED) && !options.has(HostChangeOptions.WENT_DOWN);
      }
    }
    return true;
  }

  isFailoverEnabled(): boolean {
    return (
      this.enableFailoverSetting &&
      this._rdsUrlType !== RdsUrlType.RDS_PROXY &&
      this.pluginService.getHosts() &&
      this.pluginService.getHosts().length > 0
    );
  }

  private initSettings() {
    this.enableFailoverSetting = WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.get(this._properties);
    this.failoverTimeoutMsSetting = WrapperProperties.FAILOVER_TIMEOUT_MS.get(this._properties);
    this.failoverClusterTopologyRefreshRateMsSetting = WrapperProperties.FAILOVER_CLUSTER_TOPOLOGY_REFRESH_RATE_MS.get(this._properties);
    this.failoverWriterReconnectIntervalMsSetting = WrapperProperties.FAILOVER_WRITER_RECONNECT_INTERVAL_MS.get(this._properties);
    this.failoverReaderConnectTimeoutMsSetting = WrapperProperties.FAILOVER_READER_CONNECT_TIMEOUT_MS.get(this._properties);
  }

  private async invalidInvocationOnClosedConnection() {
    if (!this._closedExplicitly) {
      this.isClosed = false;
      await this.pickNewConnection();

      // "The active SQL connection has changed. Please re-configure session state if required."
      logger.debug(Messages.get("Failover.connectionChangedError"));
      throw new FailoverSuccessError(Messages.get("Failover.connectionChangedError"));
    }
    throw new AwsWrapperError(Messages.get("Failover.noOperationsAfterConnectionClosed"));
  }

  private getCurrentWriter(): HostInfo | null {
    const topology = this.pluginService.getHosts();
    if (topology.length == 0) {
      return null;
    }
    return this.getWriter(topology);
  }

  private getWriter(hosts: HostInfo[]): HostInfo | null {
    for (const host of hosts) {
      if (host.role === HostRole.WRITER) {
        return host;
      }
    }
    return null;
  }

  async updateTopology(forceUpdate: boolean) {
    const client = this.pluginService.getCurrentClient();
    if (!this.isFailoverEnabled() || !client || !(await client.isValid())) {
      return;
    }

    if (forceUpdate) {
      await this.pluginService.forceRefreshHostList();
    } else {
      await this.pluginService.refreshHostList();
    }
  }

  override async connect<Type>(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<Type>
  ): Promise<Type> {
    logger.debug(`Start connect for test plugin: ${this.id}`);
    try {
      return await this.connectInternal(hostInfo, props, isInitialConnection, connectFunc);
    } catch (e) {
      logger.debug(e);
      throw e;
    }
  }

  override async forceConnect<Type>(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<Type>
  ): Promise<Type> {
    try {
      return await this.connectInternal(hostInfo, props, isInitialConnection, forceConnectFunc);
    } catch (e) {
      logger.debug(e);
      throw e;
    }
  }

  async connectInternal<Type>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Type): Promise<Type> {
    if (!this.hostListProviderService) {
      throw new AwsWrapperError("Host list provider service not found."); // this should not be reached
    }

    const result = await this._staleDnsHelper.getVerifiedConnection(
      hostInfo.host,
      isInitialConnection,
      this.hostListProviderService,
      props,
      connectFunc
    );

    if (isInitialConnection) {
      await this.pluginService.refreshHostList();
    }

    return result;
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>): Promise<T> {
    try {
      const start = performance.now();
      if (!this.enableFailoverSetting || this.canDirectExecute(methodName)) {
        return await methodFunc();
      }

      // TODO: !allowedOnClosedConnection(methodName); (when target driver dialects implemented)
      if (this.isClosed) {
        await this.invalidInvocationOnClosedConnection();
      }

      if (this.canUpdateTopology(methodName)) {
        await this.updateTopology(false);
      }

      return await methodFunc();
    } catch (e) {
      logger.debug(Messages.get("Failover.detectedException", JSON.stringify(e)));
      if (this._lastError !== e && this.shouldErrorTriggerClientSwitch(e)) {
        await this.invalidateCurrentClient();
        const currentHostInfo = this.pluginService.getCurrentHostInfo();
        if (currentHostInfo !== null) {
          this.pluginService.setAvailability(currentHostInfo.allAliases ?? new Set(), HostAvailability.NOT_AVAILABLE);
        }

        this._lastError = e;
        await this.pickNewConnection();
      }

      throw e;
    }
  }

  async failover(failedHost: HostInfo) {
    this.pluginService.setAvailability(failedHost.allAliases, HostAvailability.NOT_AVAILABLE);

    if (this.failoverMode === FailoverMode.STRICT_WRITER) {
      await this.failoverWriter();
    } else {
      await this.failoverReader(failedHost);
    }

    if (this._isInTransaction || this.pluginService.isInTransaction()) {
      // "Transaction resolution unknown. Please re-configure session state if required and try
      // restarting transaction."
      logger.debug(Messages.get("Failover.transactionResolutionUnknownError"));
      throw new TransactionResolutionUnknownError(Messages.get("Failover.transactionResolutionUnknownError"));
    } else {
      // "The active SQL connection has changed due to a connection failure. Please re-configure
      // session state if required."
      throw new FailoverSuccessError(Messages.get("Failover.connectionChangedError"));
    }
  }

  async failoverReader(failedHostInfo: HostInfo) {
    logger.debug(Messages.get("Failover.startReaderFailover"));
    let oldAliases = this.pluginService.getCurrentHostInfo()?.allAliases;
    if (!oldAliases) {
      oldAliases = new Set();
    }

    let failedHost = null;
    if (failedHostInfo && failedHostInfo.getRawAvailability() === HostAvailability.AVAILABLE) {
      failedHost = failedHostInfo;
    }

    const result = await this._readerFailoverHandler.failover(this.pluginService.getHosts(), failedHost);

    if (result) {
      const error = result.exception;
      if (error) {
        throw error;
      }
    }

    if (!result || !result.isConnected || !result.newHost) {
      // "Unable to establish SQL connection to reader instance"
      throw new FailoverFailedError(Messages.get("Failover.unableToConnectToReader"));
    }

    this.pluginService.getCurrentHostInfo()?.removeAlias(Array.from(oldAliases));
    await this.pluginService.tryClosingTargetClient();
    this.pluginService.setCurrentClient(result.client, result.newHost);
    await this.updateTopology(true);
  }

  async failoverWriter() {
    logger.debug(Messages.get("Failover.startWriterFailover"));
    const result = await this._writerFailoverHandler.failover(this.pluginService.getHosts());

    if (result) {
      const error = result.exception;
      if (error) {
        throw error;
      }
    }

    if (!result || !result.isConnected) {
      // "Unable to establish SQL connection to writer node"
      throw new FailoverFailedError(Messages.get("Failover.unableToConnectToWriter"));
    }

    // successfully re-connected to a writer node
    const writerHostInfo = this.getWriter(result.topology);
    if (!writerHostInfo) {
      throw new AwsWrapperError();
    }

    await this.pluginService.tryClosingTargetClient();
    this.pluginService.setCurrentClient(result.client, writerHostInfo);
    logger.debug(Messages.get("Failover.establishedConnection", this.pluginService.getCurrentHostInfo()?.host ?? ""));
    await this.pluginService.refreshHostList();
  }

  async invalidateCurrentClient() {
    const client = this.pluginService.getCurrentClient();
    if (!client || !client.targetClient) {
      return;
    }

    if (this.pluginService.isInTransaction()) {
      this._isInTransaction = this.pluginService.isInTransaction();
      try {
        // TODO: rollback not implemented
        client.rollback();
      } catch (error) {
        // swallow this error
      }
    }

    try {
      const isValid = await client.isValid();
      if (!isValid) {
        await this.pluginService.tryClosingTargetClient();
      }
    } catch (error) {
      // swallow this error, current target client should be useless anyway.
    }
  }

  async pickNewConnection() {
    if (this.isClosed && this._closedExplicitly) {
      logger.debug(Messages.get("Failover.transactionResolutionUnknownError"));
      return;
    }

    const currentClient = this.pluginService.getCurrentClient();
    const currentWriter = this.getCurrentWriter();
    if (currentWriter && (!currentClient || !currentClient.targetClient) && !this.shouldAttemptReaderConnection()) {
      try {
        await this.connectTo(currentWriter);
      } catch (error) {
        if (error instanceof AwsWrapperError) {
          await this.failover(currentWriter);
        }
      }
    } else {
      const currentHostInfo = this.pluginService.getCurrentHostInfo();
      if (currentHostInfo) {
        await this.failover(currentHostInfo);
      } else {
        throw new AwsWrapperError("Current HostInfo not found.");
      }
    }
  }

  private isWriter(hostInfo: HostInfo): boolean {
    return hostInfo.role === HostRole.WRITER;
  }

  private shouldAttemptReaderConnection(): boolean {
    const topology = this.pluginService.getHosts();
    if (!topology || this.failoverMode === FailoverMode.STRICT_WRITER) {
      return false;
    }

    for (const hostInfo of topology) {
      if (hostInfo.role === HostRole.READER) {
        return true;
      }
    }
    return false;
  }

  private canUpdateTopology(methodName: string) {
    return SubscribedMethodHelper.METHODS_REQUIRING_UPDATED_TOPOLOGY.indexOf(methodName) > -1;
  }

  private async connectTo(host: HostInfo) {
    try {
      await this.createConnectionForHost(host);
      logger.debug(Messages.get("Failover.establishedConnection", host.host));
    } catch (error) {
      if (this.pluginService.getCurrentClient()) {
        const message = "Connection to " + this.isWriter(host) ? "writer" : "reader" + " host '" + host.url + "' failed";
        logger.debug(message);
      }
      throw error;
    }
  }

  private async createConnectionForHost(baseHostInfo: HostInfo) {
    const props = new Map(this._properties);
    props.set("host", baseHostInfo.host);
    const client = this.pluginService.createTargetClient(props);
    try {
      await this.pluginService.connect(baseHostInfo, this._properties, this.pluginService.getDialect().getConnectFunc(client));
      this.pluginService.setCurrentClient(client, baseHostInfo);
    } catch (error) {
      await this.pluginService.tryClosingTargetClient(client);
      throw error;
    }
  }

  private canDirectExecute(methodName: string): boolean {
    return methodName === FailoverPlugin.METHOD_END;
  }

  private shouldErrorTriggerClientSwitch(error: any): boolean {
    if (!this.isFailoverEnabled()) {
      logger.debug(Messages.get("Failover.failoverDisabled"));
      return false;
    }

    if (error instanceof Error) {
      return this.pluginService.isNetworkError(error);
    }

    return false;
  }
}

export class FailoverPluginFactory implements ConnectionPluginFactory {
  getInstance(pluginService: PluginService, properties: Map<string, any>): ConnectionPlugin {
    return new FailoverPlugin(pluginService, properties, new RdsUtils());
  }
}
