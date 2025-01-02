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
import { PluginService } from "../../plugin_service";
import { RdsUtils } from "../../utils/rds_utils";
import { ClusterAwareReaderFailoverHandler } from "../failover/reader_failover_handler";
import { ClusterAwareWriterFailoverHandler } from "../failover/writer_failover_handler";
import { FailoverMode, failoverModeFromValue } from "../failover/failover_mode";
import { StaleDnsHelper } from "../stale_dns/stale_dns_helper";
import { TelemetryCounter } from "../../utils/telemetry/telemetry_counter";
import { HostInfo } from "../../host_info";
import { HostListProviderService } from "../../host_list_provider_service";
import { WrapperProperties } from "../../wrapper_property";
import { RdsUrlType } from "../../utils/rds_url_type";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { HostChangeOptions } from "../../host_change_options";
import { OldConnectionSuggestionAction } from "../../old_connection_suggestion_action";
import {
  AwsWrapperError,
  FailoverFailedError,
  FailoverSuccessError,
  TransactionResolutionUnknownError,
  UnavailableHostError
} from "../../utils/errors";
import { getWriter } from "../../utils/utils";
import { ClientWrapper } from "../../client_wrapper";
import { HostAvailability } from "../../host_availability/host_availability";
import { TelemetryTraceLevel } from "../../utils/telemetry/telemetry_trace_level";
import { HostRole } from "../../host_role";
import { SubscribedMethodHelper } from "../../utils/subscribed_method_helper";

export class Failover2Plugin extends AbstractConnectionPlugin {
  private static readonly TELEMETRY_WRITER_FAILOVER = "failover to writer instance";
  private static readonly TELEMETRY_READER_FAILOVER = "failover to replica";
  private static readonly METHOD_END = "end";
  private static readonly INTERNAL_CONNECT_PROPERTY_NAME: string = "76c06979-49c4-4c86-9600-a63605b83f50";
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
  private pluginService: PluginService;
  private readonly _rdsHelper: RdsUtils;
  private readonly failoverWriterTriggeredCounter: TelemetryCounter;
  private readonly failoverWriterSuccessCounter: TelemetryCounter;
  private readonly failoverWriterFailedCounter: TelemetryCounter;
  private readonly failoverReaderTriggeredCounter: TelemetryCounter;
  private readonly failoverReaderSuccessCounter: TelemetryCounter;
  private readonly failoverReaderFailedCounter: TelemetryCounter;
  private telemetryFailoverAdditionalTopTraceSetting: boolean = false;
  private _rdsUrlType: RdsUrlType | null = null;
  private _isInTransaction: boolean = false;
  private _closedExplicitly: boolean = false;
  private _lastError: any;
  /*protected failoverTimeoutMsSetting: number = WrapperProperties.FAILOVER_TIMEOUT_MS.defaultValue;
  protected failoverClusterTopologyRefreshRateMsSetting: number = WrapperProperties.FAILOVER_CLUSTER_TOPOLOGY_REFRESH_RATE_MS.defaultValue;
  protected failoverWriterReconnectIntervalMsSetting: number = WrapperProperties.FAILOVER_WRITER_RECONNECT_INTERVAL_MS.defaultValue;
  protected failoverReaderConnectTimeoutMsSetting: number = WrapperProperties.FAILOVER_READER_CONNECT_TIMEOUT_MS.defaultValue;*/
  protected isClosed: boolean = false;
  protected failoverMode: FailoverMode | null = null;

  private hostListProviderService?: HostListProviderService;
  protected enableFailoverSetting: boolean = WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.defaultValue;

  constructor(pluginService: PluginService, properties: Map<string, any>, rdsHelper: RdsUtils);
  constructor(
    pluginService: PluginService,
    properties: Map<string, any>,
    rdsHelper: RdsUtils,
    readerFailoverHandler: ClusterAwareReaderFailoverHandler,
    writerFailoverHandler: ClusterAwareWriterFailoverHandler
  );
  constructor(pluginService: PluginService, properties: Map<string, any>, rdsHelper: RdsUtils) {
    super();
    this._properties = properties;
    this.pluginService = pluginService;
    this._rdsHelper = rdsHelper;
    this._staleDnsHelper = new StaleDnsHelper(this.pluginService);

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    this.failoverWriterTriggeredCounter = telemetryFactory.createCounter("writerFailover.triggered.count");
    this.failoverWriterSuccessCounter = telemetryFactory.createCounter("writerFailover.completed.success.count");
    this.failoverWriterFailedCounter = telemetryFactory.createCounter("writerFailover.completed.failed.count");
    this.failoverReaderTriggeredCounter = telemetryFactory.createCounter("readerFailover.triggered.count");
    this.failoverReaderSuccessCounter = telemetryFactory.createCounter("readerFailover.completed.success.count");
    this.failoverReaderFailedCounter = telemetryFactory.createCounter("readerFailover.completed.failed.count");
  }

  override getSubscribedMethods(): Set<string> {
    return Failover2Plugin.subscribedMethods;
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

    logger.debug(Messages.get("Failover.parameterValue", "failoverMode", FailoverMode[this.failoverMode]));
  }

  override notifyConnectionChanged(changes: Set<HostChangeOptions>): Promise<OldConnectionSuggestionAction> {
    return Promise.resolve(OldConnectionSuggestionAction.NO_OPINION);
  }

  override async notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): Promise<void> {
    if (!this.enableFailoverSetting) {
      return Promise.resolve();
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
        return Promise.resolve();
      }

      for (const alias of currentHost.allAliases) {
        if (this.isHostStillValid(alias + "/", changes)) {
          return Promise.resolve();
        }
      }
    }
    logger.info(Messages.get("Failover.invalidHost", currentHost?.host ?? "empty host"));
    return Promise.resolve();
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
    return getWriter(topology);
  }

  async updateTopology(forceUpdate: boolean) {
    const client = this.pluginService.getCurrentClient();
    if (!this.isFailoverEnabled() || !client || !(await client.isValid())) {
      return;
    }

    if (forceUpdate) {
      // TODO: check if this correctly goes to MonitoringHostListProvider.
      await this.pluginService.forceRefreshHostList();
    } else {
      await this.pluginService.refreshHostList();
    }
  }

  override async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    // Call was initiated by Failover2 Plugin, does not require additional processing.
    if (props.has(Failover2Plugin.INTERNAL_CONNECT_PROPERTY_NAME)) {
      return await this._staleDnsHelper.getVerifiedConnection(hostInfo.host, isInitialConnection, this.hostListProviderService!, props, connectFunc);
    }

    let client = null;

    if (!this.enableFailoverSetting) {
      return await this._staleDnsHelper.getVerifiedConnection(hostInfo.host, isInitialConnection, this.hostListProviderService!, props, connectFunc);
    }

    const hostInfoWithAvailability: HostInfo = this.pluginService.getHosts().find((x) => x.getHostAndPort() === hostInfo.getHostAndPort());

    if (!hostInfoWithAvailability || hostInfoWithAvailability.getAvailability() != HostAvailability.NOT_AVAILABLE) {
      try {
        return await this._staleDnsHelper.getVerifiedConnection(
          hostInfo.host,
          isInitialConnection,
          this.hostListProviderService!,
          props,
          connectFunc
        );
      } catch (error) {
        if (this.shouldErrorTriggerClientSwitch(error)) {
          throw error;
        }

        this.pluginService.setAvailability(hostInfo.allAliases, HostAvailability.NOT_AVAILABLE);

        try {
          this.failover(hostInfo);
        } catch (error) {
          if (error instanceof FailoverSuccessError) {
            client = this.pluginService.getCurrentClient();
          }
        }
      }
    } else {
      try {
        this.pluginService.refreshHostList();
        this.failover(hostInfo);
      } catch (error) {
        if (error instanceof FailoverSuccessError) {
          client = this.pluginService.getCurrentClient();
        }
      }
    }

    if (!client) {
      // This should be unreachable, the above logic will either get a connection successfully or throw an exception.
      throw new AwsWrapperError(Messages.get("Failover2.unableToConnect"));
    }

    if (isInitialConnection) {
      this.pluginService.refreshHostList();
    }

    return client;
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>): Promise<T> {
    try {
      // Verify there aren't any unexpected error emitted while the connection was idle.
      if (this.pluginService.hasNetworkError()) {
        // Throw the unexpected error directly to be handled.
        throw this.pluginService.getUnexpectedError();
      }

      if (!this.enableFailoverSetting || this.canDirectExecute(methodName)) {
        return await methodFunc();
      }

      if (this.isClosed) {
        await this.invalidInvocationOnClosedConnection();
      }

      if (this.canUpdateTopology(methodName)) {
        await this.updateTopology(false);
      }

      return await methodFunc();
    } catch (e: any) {
      logger.debug(Messages.get("Failover.detectedException", e.message));
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

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(Failover2Plugin.TELEMETRY_READER_FAILOVER, TelemetryTraceLevel.NESTED);
    this.failoverReaderTriggeredCounter.inc();

    const oldAliases = this.pluginService.getCurrentHostInfo()?.allAliases ?? new Set();

    let failedHost = null;
    if (failedHostInfo && failedHostInfo.getRawAvailability() === HostAvailability.AVAILABLE) {
      failedHost = failedHostInfo;
    }

    try {
      await telemetryContext.start(async () => {
        // TODO: complete implementation
      });
    } finally {
      if (this.telemetryFailoverAdditionalTopTraceSetting) {
        await telemetryFactory.postCopy(telemetryContext, TelemetryTraceLevel.FORCE_TOP_LEVEL);
      }
    }
  }

  async failoverWriter() {
    logger.debug(Messages.get("Failover.startWriterFailover"));

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(Failover2Plugin.TELEMETRY_WRITER_FAILOVER, TelemetryTraceLevel.NESTED);
    this.failoverWriterTriggeredCounter.inc();

    try {
      await telemetryContext.start(async () => {
        try {
          // TODO: complete implementation
        } catch (error: any) {
          this.failoverWriterFailedCounter.inc();
          throw error;
        }
      });
    } finally {
      if (this.telemetryFailoverAdditionalTopTraceSetting) {
        await telemetryFactory.postCopy(telemetryContext, TelemetryTraceLevel.FORCE_TOP_LEVEL);
      }
    }
  }

  async invalidateCurrentClient() {
    const client = this.pluginService.getCurrentClient();
    if (!client || !client.targetClient) {
      return;
    }

    if (this.pluginService.isInTransaction()) {
      this._isInTransaction = this.pluginService.isInTransaction();
      try {
        await client.rollback();
      } catch (error) {
        // swallow this error
      }
    }

    try {
      const isValid = await client.isValid();
      if (!isValid) {
        await this.pluginService.abortCurrentClient();
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

    await this.failover(this.pluginService.getCurrentHostInfo());
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
      await this.pluginService.setCurrentClient(await this.createConnectionForHost(host), host);
      logger.debug(Messages.get("Failover.establishedConnection", host.host));
    } catch (error) {
      if (this.pluginService.getCurrentClient()) {
        const message = "Connection to " + this.isWriter(host) ? "writer" : "reader" + " host '" + host.url + "' failed";
        logger.debug(message);
      }
      throw error;
    }
  }

  private async createConnectionForHost(baseHostInfo: HostInfo): Promise<ClientWrapper> {
    const props = new Map(this._properties);
    props.set(WrapperProperties.HOST.name, baseHostInfo.host);
    return await this.pluginService.connect(baseHostInfo, props);
  }

  private canDirectExecute(methodName: string): boolean {
    return methodName === Failover2Plugin.METHOD_END;
  }

  private shouldErrorTriggerClientSwitch(error: any): boolean {
    if (!this.isFailoverEnabled()) {
      logger.debug(Messages.get("Failover.failoverDisabled"));
      return false;
    }

    if (error instanceof UnavailableHostError) {
      return true;
    }

    if (error instanceof Error) {
      return this.pluginService.isNetworkError(error);
    }

    return false;
  }
}
