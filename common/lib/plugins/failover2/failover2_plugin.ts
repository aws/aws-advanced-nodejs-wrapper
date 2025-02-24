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
  InternalQueryTimeoutError,
  TransactionResolutionUnknownError,
  UnavailableHostError
} from "../../utils/errors";
import { ClientWrapper } from "../../client_wrapper";
import { HostAvailability } from "../../host_availability/host_availability";
import { TelemetryTraceLevel } from "../../utils/telemetry/telemetry_trace_level";
import { HostRole } from "../../host_role";
import { CanReleaseResources } from "../../can_release_resources";
import { ReaderFailoverResult } from "../failover/reader_failover_result";
import { HostListProvider } from "../../host_list_provider/host_list_provider";
import { logTopology } from "../../utils/utils";

export class Failover2Plugin extends AbstractConnectionPlugin implements CanReleaseResources {
  private static readonly TELEMETRY_WRITER_FAILOVER = "failover to writer instance";
  private static readonly TELEMETRY_READER_FAILOVER = "failover to reader";
  private static readonly METHOD_END = "end";
  private static readonly SUBSCRIBED_METHODS: Set<string> = new Set(["initHostProvider", "connect", "query"]);
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
  private _lastError: any;
  failoverMode: FailoverMode = FailoverMode.UNKNOWN;

  private hostListProviderService?: HostListProviderService;
  protected enableFailoverSetting: boolean = WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.defaultValue;
  private readonly failoverTimeoutSettingMs: number = WrapperProperties.FAILOVER_TIMEOUT_MS.defaultValue;
  private readonly failoverReaderHostSelectorStrategy: string = WrapperProperties.FAILOVER_READER_HOST_SELECTOR_STRATEGY.defaultValue;

  constructor(pluginService: PluginService, properties: Map<string, any>, rdsHelper: RdsUtils) {
    super();
    this._properties = properties;
    this.pluginService = pluginService;
    this._rdsHelper = rdsHelper;
    this._staleDnsHelper = new StaleDnsHelper(this.pluginService);
    this.enableFailoverSetting = WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.get(this._properties);
    this.failoverTimeoutSettingMs = WrapperProperties.FAILOVER_TIMEOUT_MS.get(this._properties);
    this.failoverReaderHostSelectorStrategy = WrapperProperties.FAILOVER_READER_HOST_SELECTOR_STRATEGY.get(this._properties);

    const telemetryFactory = this.pluginService.getTelemetryFactory();
    this.failoverWriterTriggeredCounter = telemetryFactory.createCounter("writerFailover.triggered.count");
    this.failoverWriterSuccessCounter = telemetryFactory.createCounter("writerFailover.completed.success.count");
    this.failoverWriterFailedCounter = telemetryFactory.createCounter("writerFailover.completed.failed.count");
    this.failoverReaderTriggeredCounter = telemetryFactory.createCounter("readerFailover.triggered.count");
    this.failoverReaderSuccessCounter = telemetryFactory.createCounter("readerFailover.completed.success.count");
    this.failoverReaderFailedCounter = telemetryFactory.createCounter("readerFailover.completed.failed.count");
  }

  override getSubscribedMethods(): Set<string> {
    return Failover2Plugin.SUBSCRIBED_METHODS;
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

    this.failoverMode = failoverModeFromValue(WrapperProperties.FAILOVER_MODE.get(props));
    this._rdsUrlType = this._rdsHelper.identifyRdsType(hostInfo.host);

    if (this.failoverMode === FailoverMode.UNKNOWN) {
      this.failoverMode = this._rdsUrlType === RdsUrlType.RDS_READER_CLUSTER ? FailoverMode.READER_OR_WRITER : FailoverMode.STRICT_WRITER;
    }

    logger.debug(Messages.get("Failover.parameterValue", "failoverMode", FailoverMode[this.failoverMode]));
  }

  private isFailoverEnabled(): boolean {
    return (
      this.enableFailoverSetting &&
      this._rdsUrlType !== RdsUrlType.RDS_PROXY &&
      this.pluginService.getAllHosts() &&
      this.pluginService.getAllHosts().length > 0
    );
  }

  override async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    if (
      // Call was initiated by Failover2 Plugin, does not require additional processing.
      props.has(Failover2Plugin.INTERNAL_CONNECT_PROPERTY_NAME) ||
      // Failover is not enabled, does not require additional processing.
      !this.enableFailoverSetting ||
      !WrapperProperties.ENABLE_CLUSTER_AWARE_FAILOVER.get(props)
    ) {
      return await this._staleDnsHelper.getVerifiedConnection(hostInfo.host, isInitialConnection, this.hostListProviderService!, props, connectFunc);
    }

    const hostInfoWithAvailability: HostInfo = this.pluginService.getHosts().find((x) => x.getHostAndPort() === hostInfo.getHostAndPort());

    let client: ClientWrapper = null;
    if (!hostInfoWithAvailability || hostInfoWithAvailability.getAvailability() != HostAvailability.NOT_AVAILABLE) {
      try {
        client = await this._staleDnsHelper.getVerifiedConnection(
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
          // Unable to directly connect, attempt failover.
          await this.failover();
        } catch (error) {
          if (error instanceof FailoverSuccessError) {
            client = this.pluginService.getCurrentClient().targetClient;
          } else {
            throw error;
          }
        }
      }
    } else {
      try {
        // Host is unavailable or not part of the topology. Try to refresh host list and failover.
        await this.pluginService.refreshHostList();
        await this.failover();
      } catch (error) {
        if (error instanceof FailoverSuccessError) {
          client = this.pluginService.getCurrentClient().targetClient;
        } else {
          throw error;
        }
      }
    }

    if (!client) {
      // This should be unreachable, the above logic will either get a connection successfully or throw an error.
      throw new AwsWrapperError(Messages.get("Failover2.unableToConnect"));
    }

    if (isInitialConnection) {
      await this.pluginService.refreshHostList(client);
    }

    return client;
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>): Promise<T> {
    // Verify there weren't any unexpected errors emitted while the connection was idle.
    if (this.pluginService.hasNetworkError()) {
      // Throw the unexpected error directly to be handled.
      throw this.pluginService.getUnexpectedError();
    }

    if (!this.enableFailoverSetting || this.canDirectExecute(methodName)) {
      return await methodFunc();
    }

    let result: T = null;
    try {
      result = await methodFunc();
    } catch (error) {
      logger.debug(Messages.get("Failover.detectedError", error.message));
      if (this._lastError !== error && this.shouldErrorTriggerClientSwitch(error)) {
        await this.invalidateCurrentClient();
        const currentHostInfo: HostInfo = this.pluginService.getCurrentHostInfo();
        if (currentHostInfo !== null) {
          this.pluginService.setAvailability(currentHostInfo.allAliases ?? new Set(), HostAvailability.NOT_AVAILABLE);
        }
        await this.failover();
        this._lastError = error;
      }
      throw error;
    }
    return result;
  }

  async failover() {
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
      throw new FailoverSuccessError();
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
        if (!(await this.pluginService.forceMonitoringRefresh(false, 0))) {
          // Unable to establish SQL connection to an instance.
          this.failoverReaderFailedCounter.inc();
          logger.error(Messages.get("Failover2.unableToFetchTopology"));
          throw new FailoverFailedError(Messages.get("Failover2.unableToFetchTopology"));
        }
        try {
          const result: ReaderFailoverResult = await this.getReaderFailoverConnection(failoverEndTimeMs);
          logger.info(Messages.get("Failover.establishedConnection", result.newHost.host));
          this.failoverReaderSuccessCounter.inc();
          await this.pluginService.abortCurrentClient();
          await this.pluginService.setCurrentClient(result.client, result.newHost);
          this.pluginService.getCurrentHostInfo()?.removeAlias(Array.from(oldAliases));
          await this.pluginService.forceRefreshHostList();
        } catch (error) {
          this.failoverReaderFailedCounter.inc();
          logger.error(Messages.get("Failover.unableToConnectToReader"));
          throw new FailoverFailedError(Messages.get("Failover.unableToConnectToReader"));
        }
      });
    } finally {
      if (this.telemetryFailoverAdditionalTopTraceSetting) {
        await telemetryFactory.postCopy(telemetryContext, TelemetryTraceLevel.FORCE_TOP_LEVEL);
      }
    }
  }

  private async getReaderFailoverConnection(failoverEndTimeMs: number): Promise<ReaderFailoverResult> {
    // The roles in the host list may not be accurate, depending on whether the new topology has become available yet.
    const hosts = this.pluginService.getHosts();
    const readerCandidates = hosts.filter((x) => x.role === HostRole.READER);
    const originalWriter: HostInfo = hosts.find((x) => x.role === HostRole.WRITER);
    let isOriginalWriterStillWriter: boolean = false;

    while (Date.now() < failoverEndTimeMs) {
      // Try all the original readers.
      const remainingReaders = readerCandidates;
      while (remainingReaders.length > 0 && Date.now() < failoverEndTimeMs) {
        let readerCandidate: HostInfo = null;
        try {
          readerCandidate = this.pluginService.getHostInfoByStrategy(HostRole.READER, this.failoverReaderHostSelectorStrategy, remainingReaders);
        } catch (error) {
          logger.info(Messages.get("Failover2.errorSelectingReaderHost", error.message));
        }

        if (readerCandidate === null) {
          logger.info(Messages.get("Failover2.readerCandidateNull"));
        } else {
          try {
            const candidateClient: ClientWrapper = await this.createConnectionForHost(readerCandidate);
            const role: HostRole = await this.pluginService.getHostRole(candidateClient);
            if (role === HostRole.READER || this.failoverMode !== FailoverMode.STRICT_READER) {
              if (role !== readerCandidate.role) {
                // Update readerCandidate to reflect correct role.
                readerCandidate = this.pluginService.getHostInfoBuilder().copyFrom(readerCandidate).withRole(role).build();
              }
              return new ReaderFailoverResult(candidateClient, readerCandidate, true);
            }

            // Unable to fail over to readerCandidate, remove from remaining readers to try.
            remainingReaders.splice(remainingReaders.indexOf(readerCandidate), 1);
            await candidateClient.end();

            if (role === HostRole.WRITER) {
              // The readerCandidate is a writer, remove it from the list of reader candidates.
              readerCandidates.splice(readerCandidates.indexOf(readerCandidate), 1);
            } else {
              logger.info(Messages.get("Failover2.strictReaderUnknownHostRole"));
            }
          } catch {
            // Unable to connect to readerCandidate, remove from remaining readers to try.
            remainingReaders.splice(remainingReaders.indexOf(readerCandidate), 1);
          }
        }
      }

      // Unable to connect to any of the original readers, try to connect to original writer.
      if (originalWriter === null || Date.now() > failoverEndTimeMs) {
        // No writer found in topology, or we have timed out.
        continue;
      }

      if (this.failoverMode === FailoverMode.STRICT_READER && isOriginalWriterStillWriter) {
        // Original writer has been verified, and it is not valid in strict-reader mode.
        continue;
      }

      // Try the original writer, which may have been demoted.
      try {
        const candidateClient: ClientWrapper = await this.createConnectionForHost(originalWriter);
        const role: HostRole = await this.pluginService.getHostRole(candidateClient);
        if (role === HostRole.READER || this.failoverMode != FailoverMode.STRICT_READER) {
          const updatedHostInfo: HostInfo = this.pluginService.getHostInfoBuilder().copyFrom(originalWriter).withRole(role).build();
          return new ReaderFailoverResult(candidateClient, updatedHostInfo, true);
        }

        await candidateClient.end();

        if (role === HostRole.WRITER) {
          // Verify that writer has not been demoted, will not try to connect again.
          isOriginalWriterStillWriter = true;
        } else {
          logger.info(Messages.get("Failover2.strictReaderUnknownHostRole"));
        }
      } catch {
        logger.info(Messages.get("Failover.unableToConnectToReader"));
      }
    }

    logger.error(Messages.get("Failover.timeoutError"));
    throw new InternalQueryTimeoutError(Messages.get("Failover.timeoutError"));
  }

  async failoverWriter() {
    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(Failover2Plugin.TELEMETRY_WRITER_FAILOVER, TelemetryTraceLevel.NESTED);
    this.failoverWriterTriggeredCounter.inc();

    try {
      logger.debug(Messages.get("Failover.startWriterFailover"));
      await telemetryContext.start(async () => {
        if (!(await this.pluginService.forceMonitoringRefresh(true, this.failoverTimeoutSettingMs))) {
          // Unable to establish SQL connection to writer node.
          this.logAndThrowError(Messages.get("Failover2.unableToFetchTopology"));
        }

        const hosts: HostInfo[] = this.pluginService.getAllHosts();

        let writerCandidateClient: ClientWrapper = null;
        const writerCandidateHostInfo: HostInfo = hosts.find((x) => x.role === HostRole.WRITER);

        const allowedHosts = this.pluginService.getHosts();
        if (!allowedHosts.some((hostInfo: HostInfo) => hostInfo.host === writerCandidateHostInfo?.host)) {
          const failoverErrorMessage = Messages.get(
            "Failover.newWriterNotAllowed",
            writerCandidateHostInfo ? writerCandidateHostInfo.host : "<null>",
            logTopology(allowedHosts, "[Failover.newWriterNotAllowed] ")
          );
          logger.error(failoverErrorMessage);
          throw new FailoverFailedError(failoverErrorMessage);
        }

        if (writerCandidateHostInfo) {
          try {
            writerCandidateClient = await this.createConnectionForHost(writerCandidateHostInfo);
          } catch (err) {
            this.logAndThrowError("Failover.unableToConnectToWriter");
          }
        }

        if (!writerCandidateClient) {
          this.logAndThrowError("Failover.unableToConnectToWriter");
        }

        if ((await this.pluginService.getHostRole(writerCandidateClient)) !== HostRole.WRITER) {
          try {
            await writerCandidateClient?.end();
          } catch (error) {
            // Do nothing.
          }
          this.logAndThrowError(Messages.get("Failover2.failoverWriterConnectedToReader"));
        }

        await this.pluginService.abortCurrentClient();
        await this.pluginService.setCurrentClient(writerCandidateClient, writerCandidateHostInfo);
        logger.info(Messages.get("Failover.establishedConnection", writerCandidateHostInfo.host));
        this.failoverWriterSuccessCounter.inc();
      });
    } finally {
      if (this.telemetryFailoverAdditionalTopTraceSetting) {
        await telemetryFactory.postCopy(telemetryContext, TelemetryTraceLevel.FORCE_TOP_LEVEL);
      }
    }
  }

  private async createConnectionForHost(hostInfo: HostInfo): Promise<ClientWrapper> {
    const copyProps = new Map<string, any>(this._properties);
    // Signal to connect that this is an internal call and does not require additional processing.
    copyProps.set(Failover2Plugin.INTERNAL_CONNECT_PROPERTY_NAME, true);
    copyProps.set(WrapperProperties.HOST.name, hostInfo.host);
    return await this.pluginService.connect(hostInfo, copyProps);
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

  private logAndThrowError(errorMessage: string) {
    logger.error(errorMessage);
    this.failoverWriterFailedCounter.inc();
    throw new FailoverFailedError(errorMessage);
  }

  async releaseResources(): Promise<void> {
    const hostListProvider: HostListProvider = this.pluginService.getHostListProvider();
    if (this.pluginService.isBlockingHostListProvider(hostListProvider)) {
      await hostListProvider.clearAll();
    }
  }
}
