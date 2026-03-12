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

import { RdsUtils } from "../../utils/rds_utils";
import { GlobalDbFailoverMode, globalDbFailoverModeFromValue } from "./global_db_failover_mode";
import { HostInfo } from "../../host_info";
import { WrapperProperties } from "../../wrapper_property";
import { RdsUrlType } from "../../utils/rds_url_type";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { AwsTimeoutError, AwsWrapperError, FailoverFailedError, FailoverSuccessError, UnsupportedMethodError } from "../../utils/errors";
import { ClientWrapper } from "../../client_wrapper";
import { HostAvailability } from "../../host_availability/host_availability";
import { TelemetryTraceLevel } from "../../utils/telemetry/telemetry_trace_level";
import { HostRole } from "../../host_role";
import { ReaderFailoverResult } from "../failover/reader_failover_result";
import { containsHostAndPort, equalsIgnoreCase, getTimeInNanos, getWriter, logTopology } from "../../utils/utils";
import { Failover2Plugin } from "../failover2/failover2_plugin";
import { FullServicesContainer } from "../../utils/full_services_container";

export class GlobalDbFailoverPlugin extends Failover2Plugin {
  private static readonly TELEMETRY_FAILOVER = "failover";

  protected activeHomeFailoverMode: GlobalDbFailoverMode | null = null;
  protected inactiveHomeFailoverMode: GlobalDbFailoverMode | null = null;
  protected homeRegion: string | null = null;

  constructor(servicesContainer: FullServicesContainer, properties: Map<string, any>, rdsHelper: RdsUtils) {
    super(servicesContainer, properties, rdsHelper);
  }

  protected initFailoverMode(): void {
    if (this.rdsUrlType !== null) {
      return;
    }

    const initialHostInfo = this.hostListProviderService?.getInitialConnectionHostInfo();
    if (!initialHostInfo) {
      throw new AwsWrapperError(Messages.get("GlobalDbFailoverPlugin.missingInitialHost"));
    }

    this.rdsUrlType = this.rdsHelper.identifyRdsType(initialHostInfo.host);

    this.homeRegion = WrapperProperties.FAILOVER_HOME_REGION.get(this.properties) ?? null;
    if (!this.homeRegion) {
      if (!this.rdsUrlType.hasRegion) {
        throw new AwsWrapperError(Messages.get("GlobalDbFailoverPlugin.missingHomeRegion"));
      }
      this.homeRegion = this.rdsHelper.getRdsRegion(initialHostInfo.host);
      if (!this.homeRegion) {
        throw new AwsWrapperError(Messages.get("GlobalDbFailoverPlugin.missingHomeRegion"));
      }
    }

    logger.debug(Messages.get("Failover.parameterValue", "failoverHomeRegion", this.homeRegion));

    const activeHomeMode = WrapperProperties.ACTIVE_HOME_FAILOVER_MODE.get(this.properties);
    const inactiveHomeMode = WrapperProperties.INACTIVE_HOME_FAILOVER_MODE.get(this.properties);

    this.activeHomeFailoverMode = globalDbFailoverModeFromValue(activeHomeMode);
    this.inactiveHomeFailoverMode = globalDbFailoverModeFromValue(inactiveHomeMode);

    if (this.activeHomeFailoverMode === null) {
      switch (this.rdsUrlType) {
        case RdsUrlType.RDS_WRITER_CLUSTER:
        case RdsUrlType.RDS_GLOBAL_WRITER_CLUSTER:
          this.activeHomeFailoverMode = GlobalDbFailoverMode.STRICT_WRITER;
          break;
        default:
          this.activeHomeFailoverMode = GlobalDbFailoverMode.HOME_READER_OR_WRITER;
      }
    }

    if (this.inactiveHomeFailoverMode === null) {
      switch (this.rdsUrlType) {
        case RdsUrlType.RDS_WRITER_CLUSTER:
        case RdsUrlType.RDS_GLOBAL_WRITER_CLUSTER:
          this.inactiveHomeFailoverMode = GlobalDbFailoverMode.STRICT_WRITER;
          break;
        default:
          this.inactiveHomeFailoverMode = GlobalDbFailoverMode.HOME_READER_OR_WRITER;
      }
    }

    logger.debug(Messages.get("Failover.parameterValue", "activeHomeFailoverMode", this.activeHomeFailoverMode));
    logger.debug(Messages.get("Failover.parameterValue", "inactiveHomeFailoverMode", this.inactiveHomeFailoverMode));
  }

  override async failover(): Promise<void> {
    const telemetryFactory = this.pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(GlobalDbFailoverPlugin.TELEMETRY_FAILOVER, TelemetryTraceLevel.NESTED);

    const failoverStartTimeNs = getTimeInNanos();
    const failoverEndTimeNs = failoverStartTimeNs + BigInt(this.failoverTimeoutSettingMs) * BigInt(1_000_000);

    try {
      await telemetryContext.start(async () => {
        logger.info(Messages.get("GlobalDbFailoverPlugin.startFailover"));

        // Force refresh host list and wait for topology to stabilize
        const refreshResult = await this.pluginService.forceMonitoringRefresh(true, this.failoverTimeoutSettingMs);
        if (!refreshResult) {
          this.failoverWriterTriggeredCounter.inc();
          this.failoverWriterFailedCounter.inc();
          logger.error(Messages.get("Failover.unableToRefreshHostList"));
          throw new FailoverFailedError(Messages.get("Failover.unableToRefreshHostList"));
        }

        const updatedHosts = this.pluginService.getAllHosts();
        const writerCandidate = getWriter(updatedHosts);

        if (!writerCandidate) {
          this.failoverWriterTriggeredCounter.inc();
          this.failoverWriterFailedCounter.inc();
          const message = logTopology(updatedHosts, Messages.get("Failover.unableToDetermineWriter"));
          logger.error(message);
          throw new FailoverFailedError(message);
        }

        // Check writer region to determine failover mode
        const writerRegion = this.rdsHelper.getRdsRegion(writerCandidate.host);
        const isHomeRegion = equalsIgnoreCase(this.homeRegion, writerRegion);
        logger.debug(Messages.get("GlobalDbFailoverPlugin.isHomeRegion", String(isHomeRegion)));

        const currentFailoverMode = isHomeRegion ? this.activeHomeFailoverMode : this.inactiveHomeFailoverMode;
        logger.debug(Messages.get("GlobalDbFailoverPlugin.currentFailoverMode", String(currentFailoverMode)));

        switch (currentFailoverMode) {
          case GlobalDbFailoverMode.STRICT_WRITER:
            await this.failoverToWriter(writerCandidate);
            break;
          case GlobalDbFailoverMode.STRICT_HOME_READER:
            await this.failoverToAllowedHost(
              () => this.pluginService.getHosts().filter((x) => x.role === HostRole.READER && this.isHostInHomeRegion(x)),
              HostRole.READER,
              failoverEndTimeNs
            );
            break;
          case GlobalDbFailoverMode.STRICT_OUT_OF_HOME_READER:
            await this.failoverToAllowedHost(
              () => this.pluginService.getHosts().filter((x) => x.role === HostRole.READER && !this.isHostInHomeRegion(x)),
              HostRole.READER,
              failoverEndTimeNs
            );
            break;
          case GlobalDbFailoverMode.STRICT_ANY_READER:
            await this.failoverToAllowedHost(
              () => this.pluginService.getHosts().filter((x) => x.role === HostRole.READER),
              HostRole.READER,
              failoverEndTimeNs
            );
            break;
          case GlobalDbFailoverMode.HOME_READER_OR_WRITER:
            await this.failoverToAllowedHost(
              () =>
                this.pluginService.getHosts().filter((x) => x.role === HostRole.WRITER || (x.role === HostRole.READER && this.isHostInHomeRegion(x))),
              null,
              failoverEndTimeNs
            );
            break;
          case GlobalDbFailoverMode.OUT_OF_HOME_READER_OR_WRITER:
            await this.failoverToAllowedHost(
              () =>
                this.pluginService
                  .getHosts()
                  .filter((x) => x.role === HostRole.WRITER || (x.role === HostRole.READER && !this.isHostInHomeRegion(x))),
              null,
              failoverEndTimeNs
            );
            break;
          case GlobalDbFailoverMode.ANY_READER_OR_WRITER:
            await this.failoverToAllowedHost(() => [...this.pluginService.getHosts()], null, failoverEndTimeNs);
            break;
          default:
            throw new UnsupportedMethodError(`Unsupported failover mode: ${currentFailoverMode}`);
        }

        logger.debug(Messages.get("Failover.establishedConnection", this.pluginService.getCurrentHostInfo()?.host ?? "unknown"));
        this.throwFailoverSuccessException();
      });
    } finally {
      logger.debug(Messages.get("GlobalDbFailoverPlugin.failoverElapsed", String(getTimeInNanos() - failoverStartTimeNs)));

      if (this.telemetryFailoverAdditionalTopTraceSetting && telemetryContext) {
        await telemetryFactory.postCopy(telemetryContext, TelemetryTraceLevel.FORCE_TOP_LEVEL);
      }
    }
  }

  private isHostInHomeRegion(host: HostInfo): boolean {
    const hostRegion = this.rdsHelper.getRdsRegion(host.host);
    return equalsIgnoreCase(hostRegion, this.homeRegion);
  }

  protected async failoverToWriter(writerCandidate: HostInfo): Promise<void> {
    this.failoverWriterTriggeredCounter.inc();
    let writerCandidateConn: ClientWrapper | null = null;

    try {
      const allowedHosts = this.pluginService.getHosts();
      if (!containsHostAndPort(allowedHosts, writerCandidate.hostAndPort)) {
        this.failoverWriterFailedCounter.inc();
        const topologyString = logTopology(allowedHosts, "");
        logger.error(Messages.get("Failover.newWriterNotAllowed", writerCandidate.url, topologyString));
        throw new FailoverFailedError(Messages.get("Failover.newWriterNotAllowed", writerCandidate.url, topologyString));
      }

      try {
        writerCandidateConn = await this.pluginService.connect(writerCandidate, this.properties, this);
      } catch (error) {
        this.failoverWriterFailedCounter.inc();
        logger.error(Messages.get("Failover.unableToConnectToWriterDueToError", writerCandidate.host, error.message));
        throw new FailoverFailedError(Messages.get("Failover.unableToConnectToWriterDueToError", writerCandidate.host, error.message));
      }

      const role = await this.pluginService.getHostRole(writerCandidateConn);
      if (role !== HostRole.WRITER) {
        await writerCandidateConn?.abort();
        writerCandidateConn = null;
        this.failoverWriterFailedCounter.inc();
        logger.error(Messages.get("Failover.unexpectedReaderRole", writerCandidate.host));
        throw new FailoverFailedError(Messages.get("Failover.unexpectedReaderRole", writerCandidate.host));
      }

      await this.pluginService.setCurrentClient(writerCandidateConn, writerCandidate);
      writerCandidateConn = null; // Prevent connection from being closed in finally block

      this.failoverWriterSuccessCounter.inc();
    } catch (ex) {
      if (!(ex instanceof FailoverFailedError)) {
        this.failoverWriterFailedCounter.inc();
      }
      throw ex;
    } finally {
      if (writerCandidateConn && this.pluginService.getCurrentClient().targetClient !== writerCandidateConn) {
        await writerCandidateConn.abort();
      }
    }
  }

  protected async failoverToAllowedHost(getAllowedHosts: () => HostInfo[], verifyRole: HostRole | null, failoverEndTimeNs: bigint): Promise<void> {
    this.failoverReaderTriggeredCounter.inc();

    let result: ReaderFailoverResult | null = null;
    try {
      try {
        result = await this.getAllowedFailoverConnection(getAllowedHosts, verifyRole, failoverEndTimeNs);
        await this.pluginService.setCurrentClient(result.client!, result.newHost!);
        result = null;
      } catch (e) {
        if (e instanceof AwsTimeoutError) {
          logger.error(Messages.get("Failover.unableToConnectToReader"));
          throw new FailoverFailedError(Messages.get("Failover.unableToConnectToReader"));
        }
        throw e;
      }

      logger.info(Messages.get("Failover.establishedConnection", this.pluginService.getCurrentHostInfo()?.host ?? "unknown"));
      this.throwFailoverSuccessException();
    } catch (ex) {
      if (ex instanceof FailoverSuccessError) {
        this.failoverReaderSuccessCounter.inc();
      } else {
        this.failoverReaderFailedCounter.inc();
      }
      throw ex;
    } finally {
      if (result?.client !== this.pluginService.getCurrentClient().targetClient) {
        await result?.client.abort();
      }
    }
  }

  protected async getAllowedFailoverConnection(
    getAllowedHosts: () => HostInfo[],
    verifyRole: HostRole | null,
    failoverEndTimeNs: bigint
  ): Promise<ReaderFailoverResult> {
    do {
      await this.pluginService.refreshHostList();
      let updatedAllowedHosts = getAllowedHosts();

      // Make a copy of hosts and set their availability
      updatedAllowedHosts = updatedAllowedHosts.map((x) =>
        this.pluginService.getHostInfoBuilder().copyFrom(x).withAvailability(HostAvailability.AVAILABLE).build()
      );

      const remainingAllowedHosts = [...updatedAllowedHosts];

      if (remainingAllowedHosts.length === 0) {
        await this.shortDelay();
        continue;
      }

      while (remainingAllowedHosts.length > 0 && getTimeInNanos() < failoverEndTimeNs) {
        let candidateHost: HostInfo | undefined;
        try {
          candidateHost = this.pluginService.getHostInfoByStrategy(verifyRole, this.failoverReaderHostSelectorStrategy, remainingAllowedHosts);
        } catch {
          // Strategy can't get a host according to requested conditions.
          // Do nothing
        }

        if (!candidateHost) {
          logger.debug(logTopology(remainingAllowedHosts, `${Messages.get("GlobalDbFailoverPlugin.candidateNull", String(verifyRole))} `));
          await this.shortDelay();
          break;
        }

        let candidateConn: ClientWrapper | null = null;
        try {
          candidateConn = await this.pluginService.connect(candidateHost, this.properties, this);
          // Since the roles in the host list might not be accurate, we execute a query to check the instance's role
          const role = verifyRole === null ? null : await this.pluginService.getHostRole(candidateConn);

          if (verifyRole === null || verifyRole === role) {
            const updatedHostSpec = this.pluginService
              .getHostInfoBuilder()
              .copyFrom(candidateHost)
              .withRole(role ?? candidateHost.role)
              .build();
            return new ReaderFailoverResult(candidateConn, updatedHostSpec, true);
          }

          // The role is not as expected, so the connection is not valid
          const index = remainingAllowedHosts.findIndex((h) => h.hostAndPort === candidateHost!.hostAndPort);
          if (index !== -1) {
            remainingAllowedHosts.splice(index, 1);
          }
          await candidateConn.abort();
          candidateConn = null;
        } catch {
          const index = remainingAllowedHosts.findIndex((h) => h.hostAndPort === candidateHost!.hostAndPort);
          if (index !== -1) {
            remainingAllowedHosts.splice(index, 1);
          }
          if (candidateConn) {
            await candidateConn.abort();
          }
        }
      }
    } while (getTimeInNanos() < failoverEndTimeNs); // All hosts failed. Keep trying until we hit the timeout.

    throw new AwsTimeoutError(Messages.get("Failover.failoverReaderTimeout"));
  }

  protected shortDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 100));
  }

  override async failoverReader(): Promise<void> {
    throw new UnsupportedMethodError("This method should not be used in this class. See failover() method for implementation details.");
  }

  override async failoverWriter(): Promise<void> {
    // This method should not be used in this class. See failover() method for implementation details.
    throw new UnsupportedMethodError("This method should not be used in this class. See failover() method for implementation details.");
  }
}
