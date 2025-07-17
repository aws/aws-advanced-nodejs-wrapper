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
import { HostInfoBuilder } from "../../host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../host_availability/simple_host_availability_strategy";
import { BlueGreenStatusMonitor } from "./blue_green_status_monitor";
import { BlueGreenInterimStatus } from "./blue_green_interim_status";
import { HostInfo } from "../../host_info";
import { convertMsToNanos, getTimeInNanos, Pair } from "../../utils/utils";
import { BlueGreenRole } from "./blue_green_role";
import { BlueGreenStatus } from "./blue_green_status";
import { BlueGreenPhase } from "./blue_green_phase";
import { BlueGreenIntervalRate } from "./blue_green_interval_rate";
import { RdsUtils } from "../../utils/rds_utils";
import { WrapperProperties } from "../../wrapper_property";
import { DatabaseDialect } from "../../database_dialect/database_dialect";
import { BlueGreenDialect } from "../../database_dialect/blue_green_dialect";
import { Messages } from "../../utils/messages";
import { levels, logger } from "../../../logutils";
import { HostRole } from "../../host_role";
import { AwsWrapperError } from "../../utils/errors";
import { ConnectRouting } from "./routing/connect_routing";
import { SubstituteConnectRouting } from "./routing/substitute_connect_routing";
import { SuspendConnectRouting } from "./routing/suspend_connect_routing";
import { ExecuteRouting } from "./routing/execute_routing";
import { SuspendExecuteRouting } from "./routing/suspend_execute_routing";
import {
  SuspendUntilCorrespondingHostFoundConnectRouting
} from "./routing/suspend_until_corresponding_host_found_connect_routing";
import { RejectConnectRouting } from "./routing/reject_connect_routing";
import { getValueHash } from "./blue_green_utils";
import _ from "lodash";

export class BlueGreenStatusProvider {
  static readonly MONITORING_PROPERTY_PREFIX = "blue_green_monitoring_";
  private static readonly DEFAULT_CONNECT_TIMEOUT_MS = 10_000; // 10 seconds
  private static readonly DEFAULT_QUERY_TIMEOUT_MS = 10_000; // 10 seconds

  protected readonly hostInfoBuilder: HostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
  protected readonly monitors: BlueGreenStatusMonitor[] = [null, null];
  protected lastContextHash: number = 0;
  protected interimStatuses: BlueGreenInterimStatus[] = [null, null];
  protected hostIpAddresses: Map<string, string> = new Map();

  // The second parameter of Pair is null when no corresponding host is found.
  protected readonly correspondingHosts: Map<string, Pair<HostInfo, HostInfo | null>> = new Map();

  // all known host names; host with no port
  protected readonly roleByHost: Map<string, BlueGreenRole> = new Map();
  protected readonly iamHostSuccessfulConnects: Map<string, Set<string>> = new Map();
  protected readonly greenHostChangeNameTimes: Map<string, bigint> = new Map();
  protected summaryStatus: BlueGreenStatus | null = null;
  protected latestStatusPhase: BlueGreenPhase = BlueGreenPhase.NOT_CREATED;

  protected rollback: boolean = false;
  protected blueDnsUpdateCompleted: boolean = false;
  protected greenDnsRemoved: boolean = false;
  protected greenTopologyChanged: boolean = false;
  protected allGreenHostsChangedName: boolean = false;
  protected postStatusEndTimeNano: bigint = BigInt(0);

  // Status check interval time in millis for each BlueGreenIntervalRate.
  protected readonly statusCheckIntervalMap: Map<BlueGreenIntervalRate, bigint> = new Map();
  protected readonly switchoverTimeoutNanos: bigint;
  protected readonly suspendNewBlueConnectionsWhenInProgress: boolean;

  protected readonly pluginService: PluginService;
  protected readonly properties: Map<string, any>;
  protected readonly bgdId: string;
  protected phaseTimeNanos: Map<string, PhaseTimeInfo> = new Map();
  protected readonly rdsUtils: RdsUtils = new RdsUtils();

  constructor(pluginService: PluginService, properties: Map<string, any>, bgdId: string) {
    this.pluginService = pluginService;
    this.properties = properties;
    this.bgdId = bgdId;

    this.statusCheckIntervalMap.set(BlueGreenIntervalRate.BASELINE, BigInt(WrapperProperties.BG_INTERVAL_BASELINE_MS.get(properties)));
    this.statusCheckIntervalMap.set(BlueGreenIntervalRate.INCREASED, BigInt(WrapperProperties.BG_INTERVAL_INCREASED_MS.get(properties)));
    this.statusCheckIntervalMap.set(BlueGreenIntervalRate.HIGH, BigInt(WrapperProperties.BG_INTERVAL_HIGH_MS.get(properties)));

    this.switchoverTimeoutNanos = convertMsToNanos(WrapperProperties.BG_SWITCHOVER_TIMEOUT_MS.get(properties));
    this.suspendNewBlueConnectionsWhenInProgress = WrapperProperties.BG_SUSPEND_NEW_BLUE_CONNECTIONS.get(properties);

    const dialect: DatabaseDialect = this.pluginService.getDialect();
    if (this.isBlueGreenDialect(dialect)) {
      this.initMonitoring();
    } else {
      logger.warn(Messages.get("Bgd.unsupportedDialect", this.bgdId, dialect.getDialectName()));
    }
  }

  protected initMonitoring(): void {
    this.monitors[BlueGreenRole.SOURCE.value] = new BlueGreenStatusMonitor(
      BlueGreenRole.SOURCE,
      this.bgdId,
      this.pluginService.getCurrentHostInfo(),
      this.pluginService,
      this.getMonitoringProperties(),
      this.statusCheckIntervalMap,
      { onBlueGreenStatusChanged: (role, status) => this.prepareStatus(role, status) }
    );

    this.monitors[BlueGreenRole.TARGET.value] = new BlueGreenStatusMonitor(
      BlueGreenRole.TARGET,
      this.bgdId,
      this.pluginService.getCurrentHostInfo(),
      this.pluginService,
      this.getMonitoringProperties(),
      this.statusCheckIntervalMap,
      { onBlueGreenStatusChanged: (role, status) => this.prepareStatus(role, status) }
    );
  }

  protected getMonitoringProperties(): Map<string, any> {
    const monitoringConnProperties: Map<string, any> = new Map(this.properties);

    for (const key of monitoringConnProperties.keys()) {
      if (!key.startsWith(BlueGreenStatusProvider.MONITORING_PROPERTY_PREFIX)) {
        continue;
      }

      monitoringConnProperties.delete(key);
    }

    if (!monitoringConnProperties.has(WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name)) {
      WrapperProperties.WRAPPER_CONNECT_TIMEOUT.set(monitoringConnProperties, BlueGreenStatusProvider.DEFAULT_CONNECT_TIMEOUT_MS);
    }

    if (!monitoringConnProperties.has(WrapperProperties.WRAPPER_QUERY_TIMEOUT.name)) {
      WrapperProperties.WRAPPER_QUERY_TIMEOUT.set(monitoringConnProperties, BlueGreenStatusProvider.DEFAULT_QUERY_TIMEOUT_MS);
    }

    return monitoringConnProperties;
  }

  protected isBlueGreenDialect(dialect: any): dialect is BlueGreenDialect {
    return dialect;
  }

  protected async prepareStatus(role: BlueGreenRole, interimStatus: BlueGreenInterimStatus): Promise<void> {
    // Detect changes
    const contextHash: number = this.getContextHash();

    const storedStatus = this.interimStatuses[role.value];

    if (_.isEqual(storedStatus, interimStatus) && this.lastContextHash === contextHash) {
      // no changes detected
      logger.debug(`no changes detected for role: ${role.name}`);
      return;
    }

    // There are some changes detected. Let's update summary status.
    logger.debug(Messages.get("Bgd.interimStatus", this.bgdId, role.name, interimStatus.toString()));

    this.updatePhase(role, interimStatus);

    // Store interimStatus and corresponding hash
    this.interimStatuses[role.value] = interimStatus;
    this.lastContextHash = contextHash;

    // Update map of IP addresses.
    for (const [host, ip] of interimStatus.startIpAddressesByHostMap) {
      this.hostIpAddresses.set(host, ip);
    }

    // Update roleByHost based on provided host names.
    interimStatus.hostNames.forEach((x) => this.roleByHost.set(x.toLowerCase(), role));

    this.updateCorrespondingHosts();
    this.updateSummaryStatus(role, interimStatus);
    await this.updateMonitors();
    this.updateStatusCache();
    this.logCurrentContext();

    // Log final switchover results.
    this.logSwitchoverFinalSummary();

    this.resetContextWhenCompleted();
  }

  protected updatePhase(role: BlueGreenRole, interimStatus: BlueGreenInterimStatus): void {
    const latestInterimPhase: BlueGreenPhase = !this.interimStatuses[role.value]
      ? BlueGreenPhase.NOT_CREATED
      : this.interimStatuses[role.value].blueGreenPhase;

    if (latestInterimPhase && interimStatus.blueGreenPhase && interimStatus.blueGreenPhase.phase < latestInterimPhase.phase) {
      this.rollback = true;
      logger.debug(Messages.get("Bgd.rollback", this.bgdId));
    }

    if (!interimStatus.blueGreenPhase) {
      return;
    }

    // Do not allow status moves backward (unless it's rollback).
    // That could be caused by updating blue/green hosts delays.
    if (!this.rollback) {
      if (interimStatus.blueGreenPhase.phase >= this.latestStatusPhase.phase) {
        this.latestStatusPhase = interimStatus.blueGreenPhase;
      }
    } else {
      if (interimStatus.blueGreenPhase.phase < this.latestStatusPhase.phase) {
        this.latestStatusPhase = interimStatus.blueGreenPhase;
      }
    }
  }

  protected updateStatusCache(): void {
    this.pluginService.setStatus<BlueGreenStatus>(BlueGreenStatus, this.summaryStatus, this.bgdId);
    this.storePhaseTime(this.summaryStatus.currentPhase);
  }

  protected updateCorrespondingHosts(): void {
    this.correspondingHosts.clear();

    if (
      this.interimStatuses[BlueGreenRole.SOURCE.value] &&
      this.interimStatuses[BlueGreenRole.SOURCE.value].startTopology &&
      this.interimStatuses[BlueGreenRole.SOURCE.value].startTopology.length > 0 &&
      this.interimStatuses[BlueGreenRole.TARGET.value] &&
      this.interimStatuses[BlueGreenRole.TARGET.value].startTopology &&
      this.interimStatuses[BlueGreenRole.TARGET.value].startTopology.length > 0
    ) {
      const blueWriterHostInfo: HostInfo = this.getWriterHost(BlueGreenRole.SOURCE);
      const greenWriterHostInfo: HostInfo = this.getWriterHost(BlueGreenRole.TARGET);
      const sortedBlueReaderHostInfos: HostInfo[] = this.getReaderHosts(BlueGreenRole.SOURCE);
      const sortedGreenReaderHostInfos: HostInfo[] = this.getReaderHosts(BlueGreenRole.TARGET);

      if (blueWriterHostInfo) {
        // greenWriterHostInfo can be null but that will be handled properly by corresponding routing.
        this.correspondingHosts.set(blueWriterHostInfo.host, new Pair(blueWriterHostInfo, greenWriterHostInfo));
      }

      if (sortedGreenReaderHostInfos.length > 0) {
        let greenIndex: number = 0;
        sortedBlueReaderHostInfos.forEach((blueWriterHostInfo) => {
          this.correspondingHosts.set(blueWriterHostInfo.host, new Pair(blueWriterHostInfo, sortedGreenReaderHostInfos.at(greenIndex++)));
          greenIndex %= sortedGreenReaderHostInfos.length;
        });
      } else {
        sortedBlueReaderHostInfos.forEach((blueWriterHostInfo) => {
          this.correspondingHosts.set(blueWriterHostInfo.host, new Pair(blueWriterHostInfo, greenWriterHostInfo));
        });
      }
    }

    if (
      this.interimStatuses[BlueGreenRole.SOURCE.value] &&
      this.interimStatuses[BlueGreenRole.SOURCE.value].startTopology &&
      this.interimStatuses[BlueGreenRole.SOURCE.value].hostNames.size > 0 &&
      this.interimStatuses[BlueGreenRole.TARGET.value] &&
      this.interimStatuses[BlueGreenRole.TARGET.value].startTopology &&
      this.interimStatuses[BlueGreenRole.TARGET.value].hostNames.size > 0
    ) {
      const blueHosts: Set<string> = this.interimStatuses[BlueGreenRole.SOURCE.value].hostNames;
      const greenHosts: Set<string> = this.interimStatuses[BlueGreenRole.TARGET.value].hostNames;

      // Find corresponding cluster hosts
      const blueClusterHost: string | null =
        Array.from(blueHosts)
          .filter((host) => this.rdsUtils.isWriterClusterDns(host))
          .at(0) || null;

      const greenClusterHost: string | null =
        Array.from(greenHosts)
          .filter((host) => this.rdsUtils.isWriterClusterDns(host))
          .at(0) || null;

      if (blueClusterHost !== null && greenClusterHost !== null) {
        if (!this.correspondingHosts.has(blueClusterHost)) {
          this.correspondingHosts.set(
            blueClusterHost,
            new Pair(this.hostInfoBuilder.withHost(blueClusterHost).build(), this.hostInfoBuilder.withHost(greenClusterHost).build())
          );
        }
      }

      // Find corresponding cluster reader hosts
      const blueClusterReaderHost: string | null =
        Array.from(blueHosts)
          .filter((host) => this.rdsUtils.isReaderClusterDns(host))
          .at(0) || null;

      const greenClusterReaderHost: string | null =
        Array.from(greenHosts)
          .filter((host) => this.rdsUtils.isReaderClusterDns(host))
          .at(0) || null;

      if (blueClusterReaderHost !== null && greenClusterReaderHost !== null) {
        if (!this.correspondingHosts.has(blueClusterReaderHost)) {
          this.correspondingHosts.set(
            blueClusterReaderHost,
            new Pair(this.hostInfoBuilder.withHost(blueClusterReaderHost).build(), this.hostInfoBuilder.withHost(greenClusterReaderHost).build())
          );
        }
      }

      Array.from(blueHosts)
        .filter((host) => this.rdsUtils.isRdsCustomClusterDns(host))
        .forEach((blueHost) => {
          const customClusterName: string | null = this.rdsUtils.getRdsClusterId(blueHost);
          if (customClusterName !== null) {
            const greenHost: string | undefined = Array.from(greenHosts).find((host) => {
              return (
                this.rdsUtils.isRdsCustomClusterDns(host) &&
                customClusterName === this.rdsUtils.removeGreenInstancePrefix(this.rdsUtils.getRdsClusterId(host))
              );
            });
            if (greenHost) {
              if (!this.correspondingHosts.has(blueHost)) {
                this.correspondingHosts.set(
                  blueHost,
                  new Pair(this.hostInfoBuilder.withHost(blueHost).build(), this.hostInfoBuilder.withHost(greenHost).build())
                );
              }
            }
          }
        });
    }
  }

  protected getWriterHost(role: BlueGreenRole): HostInfo | null {
    return this.interimStatuses[role.value].startTopology.find((x) => x.role === HostRole.WRITER) || null;
  }

  protected getReaderHosts(role: BlueGreenRole): HostInfo[] {
    return Array.from(this.interimStatuses[role.value].startTopology)
      .filter((x) => x.role !== HostRole.WRITER)
      .sort();
  }

  protected updateSummaryStatus(role: BlueGreenRole, interimStatus: BlueGreenInterimStatus) {
    switch (this.latestStatusPhase) {
      case BlueGreenPhase.NOT_CREATED:
        this.summaryStatus = new BlueGreenStatus(this.bgdId, BlueGreenPhase.NOT_CREATED);
        break;
      case BlueGreenPhase.CREATED:
        this.updateDnsFlags(role, interimStatus);
        this.summaryStatus = this.getStatusOfCreated();
        break;
      case BlueGreenPhase.PREPARATION:
        this.startSwitchoverTimer();
        this.updateDnsFlags(role, interimStatus);
        this.summaryStatus = this.getStatusOfPreparation();
        break;
      case BlueGreenPhase.IN_PROGRESS:
        this.updateDnsFlags(role, interimStatus);
        this.summaryStatus = this.getStatusOfInProgress();
        break;
      case BlueGreenPhase.POST:
        this.updateDnsFlags(role, interimStatus);
        this.summaryStatus = this.getStatusOfPost();
        break;
      case BlueGreenPhase.COMPLETED:
        this.updateDnsFlags(role, interimStatus);
        this.summaryStatus = this.getStatusOfCompleted();
        break;
      default:
        throw new AwsWrapperError(Messages.get("Bgd.unknownPhase", this.bgdId, this.latestStatusPhase.name));
    }
  }

  protected async updateMonitors(): Promise<void> {
    switch (this.summaryStatus.currentPhase) {
      case BlueGreenPhase.NOT_CREATED:
        for (const monitor of this.monitors) {
          monitor.setIntervalRate(BlueGreenIntervalRate.BASELINE);
          monitor.setCollectIpAddresses(false);
          monitor.setCollectedTopology(false);
          monitor.setUseIpAddress(false);
        }
        break;

      case BlueGreenPhase.CREATED:
        for (const monitor of this.monitors) {
          monitor.setIntervalRate(BlueGreenIntervalRate.INCREASED);
          monitor.setCollectIpAddresses(true);
          monitor.setCollectedTopology(true);
          monitor.setUseIpAddress(false);
          if (this.rollback) {
            monitor.resetCollectedData();
          }
        }
        break;

      case BlueGreenPhase.PREPARATION:
      case BlueGreenPhase.IN_PROGRESS:
      case BlueGreenPhase.POST:
        this.monitors.forEach((monitor) => {
          monitor.setIntervalRate(BlueGreenIntervalRate.HIGH);
          monitor.setCollectIpAddresses(false);
          monitor.setCollectedTopology(false);
          monitor.setUseIpAddress(true);
        });
        break;

      case BlueGreenPhase.COMPLETED:
        this.monitors.forEach((monitor) => {
          monitor.setIntervalRate(BlueGreenIntervalRate.BASELINE);
          monitor.setCollectIpAddresses(false);
          monitor.setCollectedTopology(false);
          monitor.setUseIpAddress(false);
          monitor.resetCollectedData();
        });

        // Stop monitoring old/source cluster/instance
        if (!this.rollback && this.monitors[BlueGreenRole.SOURCE.value]) {
          this.monitors[BlueGreenRole.SOURCE.value].setStop(true);
        }
        break;

      default:
        throw new AwsWrapperError(Messages.get("Bgd.unknownPhase", this.bgdId, this.summaryStatus.currentPhase.name));
    }
  }

  protected updateDnsFlags(role: BlueGreenRole, interimStatus: BlueGreenInterimStatus): void {
    if (role === BlueGreenRole.SOURCE && !this.blueDnsUpdateCompleted && interimStatus.allStartTopologyIpChanged) {
      logger.debug(Messages.get("Bgd.blueDnsCompleted", this.bgdId));
      this.blueDnsUpdateCompleted = true;
      this.storeBlueDnsUpdateTime();
    }

    if (role === BlueGreenRole.TARGET && !this.greenDnsRemoved && interimStatus.allStartTopologyEndpointsRemoved) {
      logger.debug(Messages.get("Bgd.greenDnsRemoved", this.bgdId));
      this.greenDnsRemoved = true;
      this.storeGreenDnsRemoveTime();
    }

    if (role === BlueGreenRole.TARGET && !this.greenTopologyChanged && interimStatus.allTopologyChanged) {
      logger.debug(Messages.get("Bgd.greenTopologyChanged", this.bgdId));
      this.greenTopologyChanged = true;
      this.storeGreenTopologyChangeTime();
    }
  }

  protected getContextHash(): number {
    let result = getValueHash(1, this.allGreenHostsChangedName.toString());
    result = getValueHash(result, this.iamHostSuccessfulConnects.size.toString());
    return result;
  }

  protected getHostAndPort(host: string, port: number): string {
    if (port > 0) {
      return `${host}:${port}`;
    }

    return host;
  }

  // New connect requests: go to blue or green hosts; default behaviour; no routing
  // Existing connections: default behaviour; no action
  // Execute JDBC calls: default behaviour; no action
  protected getStatusOfCreated(): BlueGreenStatus {
    return new BlueGreenStatus(this.bgdId, BlueGreenPhase.CREATED, [], [], this.roleByHost, this.correspondingHosts);
  }

  /**
   * New connect requests to blue: route to corresponding IP address.
   * New connect requests to green: route to corresponding IP address
   * New connect requests with IP address: default behaviour; no routing
   * Existing connections: default behaviour; no action
   * Execute database calls: default behaviour; no action
   */
  protected getStatusOfPreparation(): BlueGreenStatus {
    // We want to limit switchover duration to DEFAULT_POST_STATUS_DURATION_NANO.

    if (this.isSwitchoverTimerExpired()) {
      logger.debug(Messages.get("Bgd.switchoverTimeout"));
      if (this.rollback) {
        return this.getStatusOfCreated();
      }
      return this.getStatusOfCompleted();
    }

    const connectRouting: ConnectRouting[] = this.addSubstituteBlueWithIpAddressConnectRouting();
    return new BlueGreenStatus(this.bgdId, BlueGreenPhase.PREPARATION, connectRouting, [], this.roleByHost, this.correspondingHosts);
  }

  protected addSubstituteBlueWithIpAddressConnectRouting(): ConnectRouting[] {
    const connectRouting: ConnectRouting[] = [];
    Array.from(this.roleByHost.entries())
      .filter(([host, role]) => role === BlueGreenRole.SOURCE && this.correspondingHosts.has(host))
      .forEach(([host, role]) => {
        const hostSpec = this.correspondingHosts.get(host).left;
        const blueIp = this.hostIpAddresses.get(hostSpec.host);
        const substituteHostSpecWithIp = !blueIp ? hostSpec : this.hostInfoBuilder.copyFrom(hostSpec).withHost(blueIp).build();

        connectRouting.push(new SubstituteConnectRouting(host, role, substituteHostSpecWithIp, [hostSpec], null));

        connectRouting.push(
          new SubstituteConnectRouting(
            this.getHostAndPort(host, this.interimStatuses[role.value].port),
            role,
            substituteHostSpecWithIp,
            [hostSpec],
            null
          )
        );
      });

    return connectRouting;
  }

  /**
   * New connect requests to blue: suspend or route to corresponding IP address (depending on settings).
   * New connect requests to green: suspend
   * New connect requests with IP address: suspend
   * Existing connections: default behaviour; no action
   * Execute database calls: suspend
   */
  protected getStatusOfInProgress(): BlueGreenStatus {
    // We want to limit switchover duration to DEFAULT_POST_STATUS_DURATION_NANO.
    if (this.isSwitchoverTimerExpired()) {
      logger.debug(Messages.get("Bgd.switchoverTimeout"));
      if (this.rollback) {
        return this.getStatusOfCreated();
      }
      return this.getStatusOfCompleted();
    }

    let connectRouting: ConnectRouting[];
    if (this.suspendNewBlueConnectionsWhenInProgress) {
      connectRouting = [];
      connectRouting.push(new SuspendConnectRouting(null, BlueGreenRole.SOURCE, this.bgdId));
    } else {
      // If we're not suspending new connections then, at least, we need to use IP addresses.
      connectRouting = this.addSubstituteBlueWithIpAddressConnectRouting();
    }

    connectRouting.push(new SuspendConnectRouting(null, BlueGreenRole.TARGET, this.bgdId));

    // All connect calls with IP address that belongs to blue or green host should be suspended.
    Array.from(this.hostIpAddresses.values())
      .filter((opt): opt is NonNullable<typeof opt> => opt !== null && opt !== undefined)
      .filter((value, index, self) => self.indexOf(value) === index) // distinct
      .forEach((ipAddress) => {
        let interimStatus: BlueGreenInterimStatus;

        if (this.suspendNewBlueConnectionsWhenInProgress) {
          // Try to confirm that the ipAddress belongs to one of the blue hosts
          interimStatus = this.interimStatuses[BlueGreenRole.SOURCE.value];
          if (interimStatus != null) {
            const hasMatchingBlueIp = Array.from(interimStatus.startIpAddressesByHostMap.values()).some((x) => x && x === ipAddress);

            if (hasMatchingBlueIp) {
              connectRouting.push(new SuspendConnectRouting(ipAddress, null, this.bgdId));
              connectRouting.push(new SuspendConnectRouting(this.getHostAndPort(ipAddress, interimStatus.port), null, this.bgdId));

              return;
            }
          }
        }

        // Try to confirm that the ipAddress belongs to one of the green hosts
        interimStatus = this.interimStatuses[BlueGreenRole.TARGET.value];
        if (interimStatus != null) {
          const hasMatchingGreenIp = Array.from(interimStatus.startIpAddressesByHostMap.values()).some((x) => x != null && x === ipAddress);

          if (hasMatchingGreenIp) {
            connectRouting.push(new SuspendConnectRouting(ipAddress, null, this.bgdId));
            connectRouting.push(new SuspendConnectRouting(this.getHostAndPort(ipAddress, interimStatus.port), null, this.bgdId));

            return;
          }
        }
      });

    // All blue and green traffic should be on hold.
    const executeRouting: ExecuteRouting[] = [];
    executeRouting.push(new SuspendExecuteRouting(null, BlueGreenRole.SOURCE, this.bgdId));
    executeRouting.push(new SuspendExecuteRouting(null, BlueGreenRole.TARGET, this.bgdId));

    // All traffic through connections with IP addresses that belong to blue or green hosts should be on hold.
    Array.from(this.hostIpAddresses.values())
      .filter((opt) => opt != null)
      .filter((value, index, self) => self.indexOf(value) === index) // distinct
      .forEach((ipAddress) => {
        // Try to confirm that the ipAddress belongs to one of the blue hosts
        let interimStatus = this.interimStatuses[BlueGreenRole.SOURCE.value];
        if (interimStatus != null) {
          const hasMatchingBlueIp = Array.from(interimStatus.startIpAddressesByHostMap.values()).some((x) => x != null && x === ipAddress);

          if (hasMatchingBlueIp) {
            executeRouting.push(new SuspendExecuteRouting(ipAddress, null, this.bgdId));
            executeRouting.push(new SuspendExecuteRouting(this.getHostAndPort(ipAddress, interimStatus.port), null, this.bgdId));

            return;
          }
        }

        // Try to confirm that the ipAddress belongs to one of the green hosts
        interimStatus = this.interimStatuses[BlueGreenRole.TARGET.value];
        if (interimStatus != null) {
          const hasMatchingGreenIp = Array.from(interimStatus.startIpAddressesByHostMap.values()).some((x) => x != null && x === ipAddress);

          if (hasMatchingGreenIp) {
            executeRouting.push(new SuspendExecuteRouting(ipAddress, null, this.bgdId));
            executeRouting.push(new SuspendExecuteRouting(this.getHostAndPort(ipAddress, interimStatus.port), null, this.bgdId));

            return;
          }
        }

        executeRouting.push(new SuspendExecuteRouting(ipAddress, null, this.bgdId));
      });
    return new BlueGreenStatus(this.bgdId, BlueGreenPhase.IN_PROGRESS, connectRouting, executeRouting, this.roleByHost, this.correspondingHosts);
  }

  protected getStatusOfPost(): BlueGreenStatus {
    // We want to limit switchover duration to DEFAULT_POST_STATUS_DURATION_NANO.
    if (this.isSwitchoverTimerExpired()) {
      logger.debug(Messages.get("Bgd.switchoverTimeout"));
      if (this.rollback) {
        return this.getStatusOfCreated();
      }
      return this.getStatusOfCompleted();
    }

    const connectRouting: ConnectRouting[] = [];
    const executeRouting: ExecuteRouting[] = [];

    this.createPostRouting(connectRouting);

    return new BlueGreenStatus(this.bgdId, BlueGreenPhase.POST, connectRouting, executeRouting, this.roleByHost, this.correspondingHosts);
  }

  protected createPostRouting(connectRouting: ConnectRouting[]): void {
    // New connect calls to blue hosts should be routed to green hosts.
    Array.from(this.roleByHost.entries())
      .filter(([host, role]) => role === BlueGreenRole.SOURCE)
      .filter(([host, role]) => this.correspondingHosts.has(host))
      .forEach(([host, role]) => {
        const blueHost: string = host;
        const isBlueHostInstance: boolean = this.rdsUtils.isRdsInstance(blueHost);
        const blueHostInfo: HostInfo = this.correspondingHosts.get(host).left;
        const greenHostInfo: HostInfo = this.correspondingHosts.get(host).right;

        if (!greenHostInfo) {
          // A corresponding host is not found. We need to suspend this call.
          connectRouting.push(new SuspendUntilCorrespondingHostFoundConnectRouting(blueHost, role, this.bgdId));
          connectRouting.push(
            new SuspendUntilCorrespondingHostFoundConnectRouting(
              this.getHostAndPort(blueHost, this.interimStatuses[role.value].port),
              role,
              this.bgdId
            )
          );
        } else {
          const greenHost: string = greenHostInfo.host;
          const greenIp = this.hostIpAddresses.get(greenHostInfo.host);
          const greenHostInfoWithIp = !greenIp ? greenHostInfo : this.hostInfoBuilder.copyFrom(greenHostInfo).withHost(greenIp).build();

          // Check whether green host has already been connected with blue (no-prefixes) IAM host name.
          const iamHosts: HostInfo[] = this.isAlreadySuccessfullyConnected(greenHost, blueHost)
            ? // Green host has already changed its name, and it's not a new blue host (no prefixes).
              [blueHostInfo]
            : // Green host isn't yet changed its name, so we need to try both possible IAM host options.
              [greenHostInfo, blueHostInfo];

          connectRouting.push(
            new SubstituteConnectRouting(
              blueHost,
              role,
              greenHostInfoWithIp,
              iamHosts,
              isBlueHostInstance ? { notify: (iamHost: string) => this.registerIamHost(greenHost, iamHost) } : null
            )
          );

          const interimStatus: BlueGreenInterimStatus = this.interimStatuses[role.value];
          if (interimStatus != null) {
            connectRouting.push(
              new SubstituteConnectRouting(
                this.getHostAndPort(blueHost, interimStatus.port),
                role,
                greenHostInfoWithIp,
                iamHosts,
                isBlueHostInstance ? { notify: (iamHost: string) => this.registerIamHost(greenHost, iamHost) } : null
              )
            );
          }
        }
      });

    if (!this.greenDnsRemoved) {
      // New connect calls to green endpoints should be rejected.
      connectRouting.push(new RejectConnectRouting(null, BlueGreenRole.TARGET));
    }
  }

  protected getStatusOfCompleted(): BlueGreenStatus {
    // We want to limit switchover duration to DEFAULT_POST_STATUS_DURATION_NANO.

    if (this.isSwitchoverTimerExpired()) {
      logger.debug(Messages.get("Bgd.switchoverTimeout"));
      if (this.rollback) {
        return this.getStatusOfCreated();
      }
      return new BlueGreenStatus(this.bgdId, BlueGreenPhase.COMPLETED, [], [], this.roleByHost, this.correspondingHosts);
    }

    // BGD reports that it's completed but DNS hasn't yet updated completely.
    // Pretend that status isn't (yet) completed.
    if (!this.blueDnsUpdateCompleted || !this.greenDnsRemoved) {
      return this.getStatusOfPost();
    }

    return new BlueGreenStatus(this.bgdId, BlueGreenPhase.COMPLETED, [], [], this.roleByHost, new Map());
  }

  protected registerIamHost(connectHost: string, iamHost: string): void {
    const differentHostNames = connectHost != null && connectHost !== iamHost;
    if (differentHostNames) {
      if (!this.isAlreadySuccessfullyConnected(connectHost, iamHost)) {
        this.greenHostChangeNameTimes.set(connectHost, BigInt(Date.now()));
        logger.debug(Messages.get("Bgd.greenHostChangedName", connectHost, iamHost));
      }
    }

    if (!this.iamHostSuccessfulConnects.has(connectHost)) {
      this.iamHostSuccessfulConnects.set(connectHost, new Set<string>());
    }
    this.iamHostSuccessfulConnects.get(connectHost)!.add(iamHost);

    if (differentHostNames) {
      // Check all IAM host changed their names
      const allHostChangedNames = Array.from(this.iamHostSuccessfulConnects.entries())
        .filter(([_, value]) => value.size > 0)
        .every(([key, value]) => Array.from(value).some((y) => key !== y));

      if (allHostChangedNames && !this.allGreenHostsChangedName) {
        logger.debug("allGreenHostsChangedName: true");
        this.allGreenHostsChangedName = true;
        this.storeGreenHostChangeNameTime();
      }
    }
  }

  protected isAlreadySuccessfullyConnected(connectHost: string, iamHost: string): boolean {
    if (!this.iamHostSuccessfulConnects.has(connectHost)) {
      this.iamHostSuccessfulConnects.set(connectHost, new Set<string>());
    }

    return this.iamHostSuccessfulConnects.get(connectHost)!.has(iamHost);
  }

  protected storePhaseTime(phase: BlueGreenPhase) {
    if (phase == null) {
      return;
    }

    const key = `${phase.name}${this.rollback ? " (rollback)" : ""}`;
    if (!this.phaseTimeNanos.has(key)) {
      this.phaseTimeNanos.set(key, new PhaseTimeInfo(new Date(), getTimeInNanos(), phase));
    }
  }

  protected storeBlueDnsUpdateTime(): void {
    const key = `Blue DNS updated${this.rollback ? " (rollback)" : ""}`;
    if (!this.phaseTimeNanos.has(key)) {
      this.phaseTimeNanos.set(key, new PhaseTimeInfo(new Date(), getTimeInNanos(), null));
    }
  }

  protected storeGreenDnsRemoveTime(): void {
    const key = `Green DNS removed${this.rollback ? " (rollback)" : ""}`;
    if (!this.phaseTimeNanos.has(key)) {
      this.phaseTimeNanos.set(key, new PhaseTimeInfo(new Date(), getTimeInNanos(), null));
    }
  }

  protected storeGreenHostChangeNameTime(): void {
    const key = `Green host certificates changed${this.rollback ? " (rollback)" : ""}`;
    if (!this.phaseTimeNanos.has(key)) {
      this.phaseTimeNanos.set(key, new PhaseTimeInfo(new Date(), getTimeInNanos(), null));
    }
  }

  protected storeGreenTopologyChangeTime(): void {
    const key = `Green topology changed ${this.rollback ? " (rollback)" : ""}`;
    if (!this.phaseTimeNanos.has(key)) {
      this.phaseTimeNanos.set(key, new PhaseTimeInfo(new Date(), getTimeInNanos(), null));
    }
  }

  protected logSwitchoverFinalSummary() {
    const switchoverCompleted =
      (!this.rollback && this.summaryStatus?.currentPhase === BlueGreenPhase.COMPLETED) ||
      (this.rollback && this.summaryStatus?.currentPhase === BlueGreenPhase.CREATED);

    const hasActiveSwitchoverPhases = Array.from(this.phaseTimeNanos.entries()).some(
      ([_, value]) => value.phase != null && value.phase.isActiveSwitchoverOrCompleted
    );

    if (!switchoverCompleted || !hasActiveSwitchoverPhases) {
      return;
    }

    const timeZeroPhase: BlueGreenPhase = this.rollback ? BlueGreenPhase.PREPARATION : BlueGreenPhase.IN_PROGRESS;
    const timeZeroKey: string = `${timeZeroPhase.name}${this.rollback ? " (rollback)" : ""}`;
    const timeZero = this.phaseTimeNanos.get(timeZeroKey);
    const divider = "----------------------------------------------------------------------------------\n";

    const logMessage =
      `[bgdId: '${this.bgdId}']` +
      "\n" +
      divider +
      `${"timestamp".padEnd(28)} ${"time offset (ms)".padStart(21)} ${"event".padStart(31)}\n` +
      divider +
      Array.from(this.phaseTimeNanos.entries())
        .sort((a, b) => Number(a[1].timestampNano - b[1].timestampNano))
        .map(
          ([key, value]) =>
            `${value.timestamp.toISOString().padStart(28)} ${
              timeZero ? Number(value.timestampNano - timeZero.timestampNano) / 1_000_000 + " ms" : "".padStart(18)
            } ${key.padStart(31)}`
        )
        .join("\n") +
      "\n" +
      divider;
    logger.info(logMessage);
  }

  protected resetContextWhenCompleted(): void {
    const switchoverCompleted =
      (!this.rollback && this.summaryStatus?.currentPhase === BlueGreenPhase.COMPLETED) ||
      (this.rollback && this.summaryStatus?.currentPhase === BlueGreenPhase.CREATED);

    const hasActiveSwitchoverPhases = Array.from(this.phaseTimeNanos.entries()).some(
      ([_, value]) => value.phase != null && value.phase.isActiveSwitchoverOrCompleted
    );

    if (switchoverCompleted && hasActiveSwitchoverPhases) {
      logger.debug(Messages.get("Bgd.resetContext"));
      this.rollback = false;
      this.summaryStatus = null;
      this.latestStatusPhase = BlueGreenPhase.NOT_CREATED;
      this.phaseTimeNanos.clear();
      this.blueDnsUpdateCompleted = false;
      this.greenDnsRemoved = false;
      this.greenTopologyChanged = false;
      this.allGreenHostsChangedName = false;
      this.postStatusEndTimeNano = BigInt(0);
      this.lastContextHash = 0;
      this.interimStatuses = [null, null];
      this.hostIpAddresses.clear();
      this.correspondingHosts.clear();
      this.roleByHost.clear();
      this.iamHostSuccessfulConnects.clear();
      this.greenHostChangeNameTimes.clear();
    }
  }

  protected startSwitchoverTimer(): void {
    if (this.postStatusEndTimeNano === BigInt(0)) {
      this.postStatusEndTimeNano = getTimeInNanos() + this.switchoverTimeoutNanos;
    }
  }

  protected isSwitchoverTimerExpired(): boolean {
    return this.postStatusEndTimeNano > 0 && getTimeInNanos() >= this.postStatusEndTimeNano;
  }

  protected logCurrentContext(): void {
    if (levels[logger.level] > levels.debug) {
      // We can skip this log message if debug level is in effect
      // and more detailed message is going to be printed few lines below.
      logger.info(
        `[bgdId: '${this.bgdId}'] BG status: ${
          this.summaryStatus == null || this.summaryStatus.currentPhase == null ? "<null>" : this.summaryStatus.currentPhase.name
        }`
      );
    }

    logger.debug(`[bgdId: '${this.bgdId}'] Summary status:\n${this.summaryStatus == null ? "<null>" : this.summaryStatus.toString()}`);

    logger.debug(
      "Corresponding hosts:\n" +
        Array.from(this.correspondingHosts.entries())
          .map(([key, value]) => `   ${key} -> ${value.right == null ? "<null>" : value.right.getHostAndPort()}`)
          .join("\n")
    );

    logger.debug(
      "Phase times:\n" +
        Array.from(this.phaseTimeNanos.entries())
          .map(([key, value]) => `   ${key} -> ${value.timestamp}`)
          .join("\n")
    );

    logger.debug(
      "Green host certificate change times:\n" +
        Array.from(this.greenHostChangeNameTimes.entries())
          .map(([key, value]) => `   ${key} -> ${value}`)
          .join("\n")
    );

    logger.debug(`
       latestStatusPhase: ${this.latestStatusPhase.name}
       blueDnsUpdateCompleted: ${this.blueDnsUpdateCompleted}
       greenDnsRemoved: ${this.greenDnsRemoved}
       greenHostChangedName: ${this.allGreenHostsChangedName}
       greenTopologyChanged: ${this.greenTopologyChanged}`);
  }

  clearResources() {
    this.monitors.forEach((monitor) => {
      monitor.setStop(true);
    });
  }
}

class PhaseTimeInfo {
  readonly timestamp: Date;
  readonly timestampNano: bigint;
  phase: BlueGreenPhase | null;

  constructor(timestamp: Date, timestampNano: bigint, phase: BlueGreenPhase | null) {
    this.timestamp = timestamp;
    this.timestampNano = timestampNano;
    this.phase = phase;
  }
}
