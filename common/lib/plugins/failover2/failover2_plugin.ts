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
import {
  AwsWrapperError,
  FailoverFailedError,
  FailoverSuccessError,
  TransactionResolutionUnknownError,
  UnavailableHostError
} from "../../utils/errors";
import { shuffleList } from "../../utils/utils";
import { ClientWrapper } from "../../client_wrapper";
import { HostAvailability } from "../../host_availability/host_availability";
import { TelemetryTraceLevel } from "../../utils/telemetry/telemetry_trace_level";
import { HostRole } from "../../host_role";
import { SubscribedMethodHelper } from "../../utils/subscribed_method_helper";
import { OldConnectionSuggestionAction } from "../../old_connection_suggestion_action";
import { HostChangeOptions } from "../../host_change_options";
import { CanReleaseResources } from "../../can_release_resources";
import { MonitoringRdsHostListProvider } from "../../host_list_provider/monitoring/monitoring_host_list_provider";

export class Failover2Plugin extends AbstractConnectionPlugin implements CanReleaseResources {
  private static readonly TELEMETRY_WRITER_FAILOVER = "failover to writer instance";
  private static readonly TELEMETRY_READER_FAILOVER = "failover to replica";
  private static readonly METHOD_END = "end";
  private static readonly subscribedMethods: Set<string> = new Set(["initHostProvider", "connect", "query", "notifyConnectionChanged"]);
  static readonly INTERNAL_CONNECT_PROPERTY_NAME: string = "monitoring_76c06979-49c4-4c86-9600-a63605b83f50";
  private readonly _staleDnsHelper: StaleDnsHelper;
  private readonly _properties: Map<string, any>;
  private readonly pluginService: PluginService;
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
  protected isClosed: boolean = false;
  failoverMode: FailoverMode = FailoverMode.UNKNOWN;

  private hostListProviderService?: HostListProviderService;
  protected enableFailoverSetting: boolean = WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.defaultValue;
  private failoverTimeoutSettingMs: number = WrapperProperties.FAILOVER_TIMEOUT_MS.defaultValue;

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
    this.enableFailoverSetting = WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.get(this._properties);
    this.failoverTimeoutSettingMs = WrapperProperties.FAILOVER_TIMEOUT_MS.get(this._properties);

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

  private isFailoverEnabled(): boolean {
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

  async updateTopology() {
    const client = this.pluginService.getCurrentClient();
    if (!this.isFailoverEnabled() || !(await client.isValid())) {
      return;
    }

    await this.pluginService.refreshHostList();
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
        if (!this.shouldErrorTriggerClientSwitch(error)) {
          throw error;
        }

        this.pluginService.setAvailability(hostInfo.allAliases, HostAvailability.NOT_AVAILABLE);

        try {
          await this.failover(hostInfo);
        } catch (error) {
          if (error instanceof FailoverSuccessError) {
            client = this.pluginService.getCurrentClient();
          }
        }
      }
    } else {
      try {
        await this.pluginService.refreshHostList();
        await this.failover(hostInfo);
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
      await this.pluginService.refreshHostList();
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
        await this.updateTopology();
      }

      return await methodFunc();
    } catch (e: any) {
      logger.debug(Messages.get("Failover.detectedError", e.message));
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
      await this.failoverReader();
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

  async failoverReader() {
    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(Failover2Plugin.TELEMETRY_READER_FAILOVER, TelemetryTraceLevel.NESTED);
    this.failoverReaderTriggeredCounter.inc();

    const oldAliases = this.pluginService.getCurrentHostInfo()?.allAliases ?? new Set();
    const failoverEndTimeMs = Date.now() + this.failoverTimeoutSettingMs;

    try {
      logger.debug(Messages.get("Failover.startReaderFailover"));
      await telemetryContext.start(async () => {
        if (!(await this.pluginService.initiateTopologyUpdate(false, 0))) {
          // Unable to establish SQL connection to an instance.
          this.failoverReaderFailedCounter.inc();
          logger.warn(Messages.get("Failover2.unableToFetchTopology"));
          throw new FailoverFailedError(Messages.get("Failover.unableToConnectToReader"));
        }

        // Signal to connect that this is an internal call and does not require additional processing.
        const copyProps = new Map<string, any>(this._properties);
        copyProps.set(Failover2Plugin.INTERNAL_CONNECT_PROPERTY_NAME, true);

        const hosts: HostInfo[] = this.pluginService.getHosts();
        const hostsByPriority = this.getHostsByPriority(hosts);
        let readerCandidateClient: ClientWrapper = null;
        let readerCandidateHostInfo: HostInfo = null;

        while (hostsByPriority.length > 0 && readerCandidateClient === null && Date.now() < failoverEndTimeMs) {
          readerCandidateHostInfo = hostsByPriority.shift();
          try {
            readerCandidateClient = await this.pluginService.connect(readerCandidateHostInfo, copyProps);
          } catch (err) {
            readerCandidateClient = null;
          }
        }

        if (
          readerCandidateClient === null ||
          ((await this.pluginService.getHostRole(readerCandidateClient)) === HostRole.WRITER && this.failoverMode === FailoverMode.STRICT_READER)
        ) {
          logger.warn(Messages.get("Failover.unableToConnectToReader"));
          this.failoverReaderFailedCounter.inc();
          throw new FailoverFailedError(Messages.get("Failover.unableToConnectToReader"));
        }

        logger.info(Messages.get("Failover.establishedConnection", readerCandidateHostInfo.host));
        this.pluginService.getCurrentHostInfo()?.removeAlias(Array.from(oldAliases));
        await this.pluginService.abortCurrentClient();
        await this.pluginService.setCurrentClient(readerCandidateClient, readerCandidateHostInfo);
        await this.updateTopology();
        this.failoverReaderSuccessCounter.inc();
      });
    } finally {
      if (this.telemetryFailoverAdditionalTopTraceSetting) {
        await telemetryFactory.postCopy(telemetryContext, TelemetryTraceLevel.FORCE_TOP_LEVEL);
      }
    }
  }

  async failoverWriter() {
    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(Failover2Plugin.TELEMETRY_WRITER_FAILOVER, TelemetryTraceLevel.NESTED);
    this.failoverWriterTriggeredCounter.inc();

    try {
      logger.debug(Messages.get("Failover.startWriterFailover"));
      await telemetryContext.start(async () => {
        if (!(await this.pluginService.initiateTopologyUpdate(true, this.failoverTimeoutSettingMs))) {
          // Unable to establish SQL connection to writer node.
          this.failoverWriterFailedCounter.inc();
          logger.warn(Messages.get("Failover2.unableToFetchTopology"));
          throw new FailoverFailedError(Messages.get("Failover.unableToConnectToWriter"));
        }

        await this.updateTopology();
        const hosts: HostInfo[] = this.pluginService.getHosts();

        // Signal to connect that this is an internal call and does not require additional processing.
        const copyProps = new Map<string, any>(this._properties);
        copyProps.set(Failover2Plugin.INTERNAL_CONNECT_PROPERTY_NAME, true);

        let writerCandidateClient: ClientWrapper = null;
        const writerCandidateHostInfo: HostInfo = hosts.find((x) => x.role === HostRole.WRITER);

        if (writerCandidateHostInfo) {
          try {
            writerCandidateClient = await this.pluginService.connect(writerCandidateHostInfo, copyProps);
          } catch (err) {
            // Do nothing.
          }
        }

        if (!writerCandidateClient) {
          logger.warn(Messages.get("Failover.unableToConnectToWriter"));
          this.failoverWriterFailedCounter.inc();
          throw new FailoverFailedError(Messages.get("Failover.unableToConnectToWriter"));
        }

        if ((await this.pluginService.getHostRole(writerCandidateClient)) !== HostRole.WRITER) {
          try {
            await writerCandidateClient.end();
          } catch (error) {
            // Do nothing.
          }
          logger.warn(Messages.get("Failover2.failoverWriterConnectedToReader"));
          this.failoverWriterFailedCounter.inc();
          throw new FailoverFailedError(Messages.get("Failover2.failoverWriterConnectedToReader"));
        }

        await this.pluginService.abortCurrentClient();
        await this.pluginService.setCurrentClient(writerCandidateClient, writerCandidateHostInfo);
        logger.info(Messages.get("Failover.establishedConnection", writerCandidateHostInfo.host));
        await this.updateTopology();
        this.failoverWriterSuccessCounter.inc();
      });
    } finally {
      if (this.telemetryFailoverAdditionalTopTraceSetting) {
        await telemetryFactory.postCopy(telemetryContext, TelemetryTraceLevel.FORCE_TOP_LEVEL);
      }
    }
  }

  getHostsByPriority(hosts: HostInfo[]): HostInfo[] {
    const activeReaders: HostInfo[] = [];
    const downHostList: HostInfo[] = [];
    let writerHost: HostInfo | undefined;
    hosts.forEach((host) => {
      if (host.role === HostRole.WRITER) {
        writerHost = host;
        return;
      }

      if (host.availability === HostAvailability.AVAILABLE) {
        activeReaders.push(host);
      } else {
        downHostList.push(host);
      }
    });

    shuffleList(activeReaders);
    shuffleList(downHostList);

    const hostsByPriority: HostInfo[] = [...activeReaders];
    const numReaders: number = activeReaders.length + downHostList.length;
    if (writerHost && (!(this.failoverMode === FailoverMode.STRICT_READER) || numReaders === 0)) {
      hostsByPriority.push(writerHost);
    }
    hostsByPriority.push(...downHostList);

    return hostsByPriority;
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
        // Do nothing.
      }
    }

    try {
      const isValid = await client.isValid();
      if (!isValid) {
        await this.pluginService.abortCurrentClient();
      }
    } catch (error) {
      // Do nothing.
    }
  }

  async pickNewConnection() {
    if (this.isClosed && this._closedExplicitly) {
      logger.debug(Messages.get("Failover.connectionExplicitlyClosed"));
      return;
    }

    await this.failover(this.pluginService.getCurrentHostInfo());
  }

  private canUpdateTopology(methodName: string) {
    return SubscribedMethodHelper.METHODS_REQUIRING_UPDATED_TOPOLOGY.indexOf(methodName) > -1;
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

  async releaseResources(): Promise<void> {
    await (this.pluginService.getHostListProvider() as MonitoringRdsHostListProvider).clearAll();
  }
}
