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

import { BlueGreenRole } from "./blue_green_role";
import { BlueGreenInterimStatus } from "./blue_green_interim_status";
import { BlueGreenDialect, BlueGreenResult } from "../../database_dialect/blue_green_dialect";
import { PluginService } from "../../plugin_service";
import { BlueGreenIntervalRate } from "./blue_green_interval_rate";
import { HostInfo } from "../../host_info";
import { RdsUtils } from "../../utils/rds_utils";
import { HostInfoBuilder } from "../../host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../host_availability/simple_host_availability_strategy";
import { HostListProvider } from "../../host_list_provider/host_list_provider";
import { BlueGreenPhase } from "./blue_green_phase";
import { ClientWrapper } from "../../client_wrapper";
import { Messages } from "../../utils/messages";
import { logger } from "../../../logutils";
import { convertMsToNanos, getTimeInNanos, sleep } from "../../utils/utils";
import { lookup } from "dns";
import { promisify } from "util";
import { WrapperProperties } from "../../wrapper_property";
import { HostListProviderService } from "../../host_list_provider_service";
import { StatusInfo } from "./status_info";
import { DatabaseDialect } from "../../database_dialect/database_dialect";
import { AwsWrapperError } from "../../utils/errors";

export interface OnBlueGreenStatusChange {
  onBlueGreenStatusChanged(role: BlueGreenRole, interimStatus: BlueGreenInterimStatus): void;
}

export class BlueGreenStatusMonitor {
  protected static readonly ONE_MINUTE_IN_MS: number = 60 * 1000;
  protected static readonly DEFAULT_CHECK_INTERVAL_MS: number = 5 * this.ONE_MINUTE_IN_MS;
  protected static readonly latestKnownVersion: string = "1.0";
  protected static readonly BG_CLUSTER_ID = "941d00a8-8238-4f7d-bf59-771bff783a8e";
  // Add more versions here if needed.
  protected static readonly knownVersions: Set<string> = new Set<string>([BlueGreenStatusMonitor.latestKnownVersion]);

  protected readonly blueGreenDialect: BlueGreenDialect;
  protected readonly pluginService: PluginService;
  protected readonly bgdId: string;
  protected readonly props: Map<string, any>;
  protected readonly role: BlueGreenRole;
  protected readonly onBlueGreenStatusChangeFunc: OnBlueGreenStatusChange;

  // Status check interval time in millis for each BlueGreenIntervalRate.
  protected readonly statusCheckIntervalMap: Map<BlueGreenIntervalRate, bigint>;

  protected readonly initialHostInfo: HostInfo;

  protected readonly rdsUtils: RdsUtils = new RdsUtils();

  protected readonly hostInfoBuilder: HostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
  protected collectedIpAddresses: boolean = true;
  protected collectedTopology: boolean = true;

  protected intervalRate: BlueGreenIntervalRate = BlueGreenIntervalRate.BASELINE;
  protected stop: boolean = false;
  protected useIpAddress: boolean = false;

  protected hostListProvider: HostListProvider | null = null;
  protected startTopology: HostInfo[] = [];
  protected currentTopology: HostInfo[] = [];
  protected startIpAddressesByHostMap: Map<string, string> = new Map();
  protected currentIpAddressesByHostMap: Map<string, string> = new Map();

  // Track all endpoints in startTopology and check whether all their IP addresses have changed.
  protected allStartTopologyIpChanged: boolean = false;

  // Track all endpoints in startTopology and check whether they are removed (i.e. DNS could not be resolved).
  protected allStartTopologyEndpointsRemoved: boolean = false;
  protected allTopologyChanged: boolean = false;
  protected currentPhase: BlueGreenPhase | null = BlueGreenPhase.NOT_CREATED;
  protected hostNames: Set<string> | null = new Set<string>(); // No port

  protected version: string = "1.0";
  protected port: number = -1;

  protected clientWrapper: ClientWrapper | null = null;
  protected connectionHostInfo: HostInfo | null = null;
  protected connectedIpAddress: string | null = null;
  protected connectionHostInfoCorrect: boolean = false;
  protected panicMode: boolean = true;

  constructor(
    role: BlueGreenRole,
    bgdId: string,
    initialHostInfo: HostInfo,
    pluginService: PluginService,
    props: Map<string, any>,
    statusCheckIntervalMap: Map<BlueGreenIntervalRate, bigint>,
    onBlueGreenStatusChangeFunc: OnBlueGreenStatusChange
  ) {
    this.role = role;
    this.bgdId = bgdId;
    this.initialHostInfo = initialHostInfo;
    this.pluginService = pluginService;
    this.props = props;
    this.statusCheckIntervalMap = statusCheckIntervalMap;
    this.onBlueGreenStatusChangeFunc = onBlueGreenStatusChangeFunc;

    const dialect: DatabaseDialect = this.pluginService.getDialect();
    if (!BlueGreenStatusMonitor.implementsBlueGreenDialect(dialect)) {
      throw new AwsWrapperError(Messages.get("Bgd.unsupportedDialect", bgdId, dialect.getDialectName()));
    }
    this.blueGreenDialect = <BlueGreenDialect>(<unknown>this.pluginService.getDialect());

    // Intentionally not calling await on this method.
    this.runMonitoringLoop();
  }

  private static implementsBlueGreenDialect(dialect: any): dialect is BlueGreenDialect {
    return typeof dialect?.isBlueGreenStatusAvailable === "function" && typeof dialect?.getBlueGreenStatus === "function";
  }

  protected async runMonitoringLoop(): Promise<void> {
    try {
      while (!this.stop) {
        const oldPhase: BlueGreenPhase | null = this.currentPhase;
        await this.openConnection();
        await this.collectStatus();
        await this.collectTopology();
        await this.collectHostIpAddresses();
        this.updateIpAddressFlags();

        if (this.currentPhase !== null && (oldPhase === null || oldPhase !== this.currentPhase)) {
          logger.debug(Messages.get("Bgd.statusChanged", this.role.name, this.currentPhase.name));
        }

        if (this.onBlueGreenStatusChangeFunc !== null) {
          this.onBlueGreenStatusChangeFunc.onBlueGreenStatusChanged(
            this.role,
            new BlueGreenInterimStatus(
              this.currentPhase,
              this.version,
              this.port,
              this.startTopology,
              this.currentTopology,
              this.startIpAddressesByHostMap,
              this.currentIpAddressesByHostMap,
              this.hostNames,
              this.allStartTopologyIpChanged,
              this.allStartTopologyEndpointsRemoved,
              this.allTopologyChanged
            )
          );

          const delayMs: number = Number(
            this.statusCheckIntervalMap.get(
              (this.panicMode ? BlueGreenIntervalRate.HIGH : this.intervalRate) ?? BlueGreenStatusMonitor.DEFAULT_CHECK_INTERVAL_MS
            )
          );

          await this.delay(delayMs);
        }
      }
    } catch (e: any) {
      logger.debug(Messages.get("Bgd.monitoringUnhandledError", this.role.name, JSON.stringify(e)));
    } finally {
      await this.closeConnection();
      logger.debug(Messages.get("Bgd.monitoringCompleted", this.role.name));
    }
  }

  protected async delay(delayMs: number): Promise<void> {
    const start: bigint = getTimeInNanos();
    const end: bigint = start + convertMsToNanos(delayMs);
    const currentBlueGreenIntervalRate: BlueGreenIntervalRate = this.intervalRate;

    const currentPanic: boolean = this.panicMode;
    const minDelay = Math.min(delayMs, 50);

    // Repeat until the intervalType has changed, the stop flag has changed, the panic mode flag has changed,
    // or we have hit the specified delay time.

    do {
      await sleep(minDelay);
    } while (this.intervalRate === currentBlueGreenIntervalRate && getTimeInNanos() < end && !this.stop && this.panicMode === currentPanic);
  }

  setIntervalRate(blueGreenIntervalRate: BlueGreenIntervalRate): void {
    this.intervalRate = blueGreenIntervalRate;
  }

  setCollectIpAddresses(collectIpAddresses: boolean): void {
    this.collectedIpAddresses = collectIpAddresses;
  }

  setCollectedTopology(collectedTopology: boolean): void {
    this.collectedTopology = collectedTopology;
  }

  setUseIpAddress(useIpAddresses: boolean): void {
    this.useIpAddress = useIpAddresses;
  }

  setStop(stop: boolean): void {
    this.stop = stop;
  }

  resetCollectedData(): void {
    this.startIpAddressesByHostMap.clear();
    this.startTopology = [];
    this.hostNames.clear();
  }

  protected async collectHostIpAddresses(): Promise<void> {
    this.currentIpAddressesByHostMap.clear();

    if (this.hostNames === null) {
      return;
    }

    for (const host of this.hostNames) {
      if (this.currentIpAddressesByHostMap.has(host)) {
        continue;
      }
      this.currentIpAddressesByHostMap.set(host, await this.getIpAddress(host));
    }
    if (this.collectedIpAddresses) {
      this.startIpAddressesByHostMap.clear();
      this.startIpAddressesByHostMap = new Map([...this.currentIpAddressesByHostMap]);
    }
  }

  protected updateIpAddressFlags(): void {
    if (this.collectedIpAddresses) {
      this.allStartTopologyIpChanged = false;
      this.allStartTopologyEndpointsRemoved = false;
      this.allTopologyChanged = false;
      return;
    }

    if (!this.collectedIpAddresses) {
      // Check whether all hosts in startTopology resolve to new IP addresses.
      this.allStartTopologyIpChanged =
        this.startTopology.length > 0 &&
        this.startTopology.every((x) => {
          const host = x.host;
          const startIp = this.startIpAddressesByHostMap.get(host);
          const currentIp = this.currentIpAddressesByHostMap.get(host);

          return startIp !== undefined && currentIp !== undefined && startIp !== currentIp;
        });
    }

    // Check whether all hosts in startTopology no longer have IP addresses. This indicates that the startTopology
    // hosts can no longer be resolved because their DNS entries no longer exist.
    this.allStartTopologyEndpointsRemoved =
      this.startTopology.length > 0 &&
      this.startTopology.every((x) => {
        const host = x.host;
        const startIp = this.startIpAddressesByHostMap.get(host);
        const currentIp = this.currentIpAddressesByHostMap.get(host);

        return startIp !== null && !currentIp;
      });

    if (!this.collectedTopology) {
      // Check whether all hosts in currentTopology do not exist in startTopology
      const startTopologyNodes: Set<string> = !this.startTopology ? new Set<string>() : new Set(this.startTopology.map((hostSpec) => hostSpec.host));

      const currentTopologyCopy = this.currentTopology;

      this.allTopologyChanged =
        currentTopologyCopy &&
        currentTopologyCopy.length > 0 &&
        startTopologyNodes.size > 0 &&
        !currentTopologyCopy.some((host) => startTopologyNodes.has(host.host));
    }
  }

  protected async getIpAddress(host: string): Promise<string | null> {
    try {
      const lookupResult = await promisify(lookup)(host, {});
      return lookupResult.address;
    } catch (error) {
      return null;
    }
  }

  protected async collectTopology(): Promise<void> {
    if (!this.hostListProvider) {
      return;
    }

    const client: ClientWrapper = this.clientWrapper;
    if (await this.isConnectionClosed(client)) {
      return;
    }

    this.currentTopology = await this.hostListProvider.forceRefresh(client);
    if (this.collectedTopology) {
      this.startTopology = this.currentTopology;
    }

    // Do not update endpoints when topology is frozen.
    const currentTopologyCopy = this.currentTopology;

    if (currentTopologyCopy && this.collectedTopology) {
      this.hostNames = new Set(currentTopologyCopy.map((hostSpec) => hostSpec.host));
    }
  }

  protected async closeConnection(): Promise<void> {
    const client: ClientWrapper = this.clientWrapper;
    this.clientWrapper = null;

    try {
      if (client && (await this.pluginService.isClientValid(client))) {
        await client.end();
      }
    } catch (e: any) {
      // ignore
    }
  }

  protected async collectStatus(): Promise<void> {
    const client: ClientWrapper = this.clientWrapper;
    try {
      if (await this.isConnectionClosed(client)) {
        return;
      }

      if (!(await this.blueGreenDialect.isBlueGreenStatusAvailable(client))) {
        if (await this.pluginService.isClientValid(client)) {
          this.currentPhase = BlueGreenPhase.NOT_CREATED;
          logger.debug(Messages.get("Bgd.statusNotAvailable", this.role.name, BlueGreenPhase.NOT_CREATED.name));
        } else {
          this.clientWrapper = null;
          this.currentPhase = null;
          this.panicMode = true;
        }
        return;
      }

      const statusEntries: StatusInfo[] = [];
      const results: BlueGreenResult[] = await this.blueGreenDialect.getBlueGreenStatus(client);
      if (results !== null) {
        for (const result of results) {
          let version = result.version;
          if (!BlueGreenStatusMonitor.knownVersions.has(version)) {
            const versionCopy: string = version;
            version = BlueGreenStatusMonitor.latestKnownVersion;
            logger.warn(Messages.get("Bgd.unknownVersion", versionCopy));
          }
          const role: BlueGreenRole = BlueGreenRole.parseRole(result.role, version);
          const phase: BlueGreenPhase = BlueGreenPhase.parsePhase(result.status, version);

          if (this.role !== role) {
            continue;
          }

          statusEntries.push(new StatusInfo(version, result.endpoint, result.port, phase, role));
        }
      }

      // Check if there's a cluster writer endpoint;
      let statusInfo: StatusInfo | undefined = statusEntries.find(
        (x) => this.rdsUtils.isWriterClusterDns(x.endpoint) && this.rdsUtils.isNotOldInstance(x.endpoint)
      );

      if (statusInfo !== undefined) {
        // Cluster writer endpoint found.
        // Add cluster reader endpoint as well.
        this.hostNames.add(statusInfo.endpoint.toLowerCase().replace(".cluster-", ".cluster-ro-"));
      }

      if (statusInfo === undefined) {
        // maybe it's an instance endpoint?
        statusInfo = statusEntries.find((x) => this.rdsUtils.isRdsInstance(x.endpoint) && this.rdsUtils.isNotOldInstance(x.endpoint));
      }

      if (statusInfo === undefined) {
        if (statusEntries.length === 0) {
          // It's normal to expect that the status table has no entries after BGD is completed.
          // Old1 cluster/instance has been separated and no longer receives
          // updates from related green cluster/instance.
          if (this.role !== BlueGreenRole.SOURCE) {
            logger.warn(Messages.get("Bgd.noEntriesInStatusTable", this.role.name));
          }
          this.currentPhase = null;
        }
      } else {
        this.currentPhase = statusInfo.phase;
        this.version = statusInfo.version;
        this.port = statusInfo.port;
      }

      if (this.collectedTopology) {
        statusEntries
          .filter((x) => x.endpoint != null && this.rdsUtils.isNotOldInstance(x.endpoint))
          .forEach((x) => this.hostNames.add(x.endpoint.toLowerCase()));
      }

      if (!this.connectionHostInfoCorrect && statusInfo !== undefined) {
        // We connected to an initialHostInfo that might be not the desired Blue or Green cluster.
        // We need to reconnect to a correct one.

        const statusInfoHostIpAddress: string | null = await this.getIpAddress(statusInfo.endpoint);
        const connectedIpAddressCopy = this.connectedIpAddress;

        if (connectedIpAddressCopy !== null && connectedIpAddressCopy !== statusInfoHostIpAddress) {
          // Found endpoint confirms that we're connected to a different node, and we need to reconnect.
          this.connectionHostInfo = this.hostInfoBuilder.withHost(statusInfo.endpoint).withPort(statusInfo.port).build();
          this.connectionHostInfoCorrect = true;
          await this.closeConnection();
          this.panicMode = true;
        } else {
          // We're already connected to a correct node.
          this.connectionHostInfoCorrect = true;
          this.panicMode = false;
        }
      }

      if (this.connectionHostInfoCorrect && this.hostListProvider == null) {
        // A connection to a correct cluster (blue or green) is established.
        // Let's initialize HostListProvider
        this.initHostListProvider();
      }
    } catch (e: any) {
      if (this.pluginService.isSyntaxError(e)) {
        this.currentPhase = BlueGreenPhase.NOT_CREATED;
        logger.warn(Messages.get("Bgd.error", this.role.name, BlueGreenPhase.NOT_CREATED.name, e.message));
      }
      if (this.pluginService.isNetworkError(e)) {
        if (!(await this.isConnectionClosed(client))) {
          // It's normal to get connection closed during BGD switchover.
          // If connection isn't closed but there's an error then let's log it.
          logger.debug(Messages.get("Bgd.unhandledNetworkError", this.role.name, e.message));
        }
        await this.closeConnection();
        this.panicMode = true;
      } else {
        logger.debug(Messages.get("Bgd.unhandledError", this.role.name, e.message));
      }
    }
  }

  protected async isConnectionClosed(client: ClientWrapper): Promise<boolean> {
    return !client || !(await this.pluginService.isClientValid(client));
  }

  protected async openConnection(): Promise<void> {
    if (this.clientWrapper != null && !(await this.isConnectionClosed(this.clientWrapper))) {
      return;
    }

    await this.openConnectionAsync();
  }

  protected async openConnectionAsync(): Promise<void> {
    this.clientWrapper = null;
    this.panicMode = true;

    if (this.connectionHostInfo === null) {
      this.connectionHostInfo = this.initialHostInfo;
      this.connectedIpAddress = null;
      this.connectionHostInfoCorrect = false;
    }

    const connectionHostInfoCopy = this.connectionHostInfo;
    let connectedIpAddressCopy = this.connectedIpAddress;

    try {
      if (this.useIpAddress && connectedIpAddressCopy !== null) {
        const connectionWithIpHostInfo: HostInfo = this.hostInfoBuilder.copyFrom(connectionHostInfoCopy).withHost(connectedIpAddressCopy).build();
        const connectWithIpProperties: Map<string, any> = new Map(this.props);

        WrapperProperties.IAM_HOST.set(connectWithIpProperties, this.connectionHostInfo.host);

        logger.debug(Messages.get("Bgd.openingConnectionWithIp", this.role.name, connectionWithIpHostInfo.host));

        this.clientWrapper = await this.pluginService.forceConnect(connectionWithIpHostInfo, connectWithIpProperties);
        logger.debug(Messages.get("Bgd.openedConnectionWithIp", this.role.name, connectionWithIpHostInfo.host));
      } else {
        const finalConnectionHostInfoCopy: HostInfo = connectionHostInfoCopy;
        logger.debug(Messages.get("Bgd.openingConnection", this.role.name, finalConnectionHostInfoCopy.host));

        connectedIpAddressCopy = await this.getIpAddress(connectionHostInfoCopy.host);
        this.clientWrapper = await this.pluginService.forceConnect(connectionHostInfoCopy, this.props);
        this.connectedIpAddress = connectedIpAddressCopy;

        logger.debug(Messages.get("Bgd.openedConnection", this.role.name, finalConnectionHostInfoCopy.host));
      }
      this.panicMode = false;
    } catch (error: any) {
      this.clientWrapper = null;
      this.panicMode = true;
    }
  }

  protected initHostListProvider(): void {
    if (this.hostListProvider || !this.connectionHostInfoCorrect) {
      return;
    }

    const hostListProperties: Map<string, any> = new Map(this.props);

    // Need to instantiate a separate HostListProvider with
    // a special unique clusterId to avoid interference with other HostListProviders opened for this cluster.
    // Blue and Green clusters are expected to have different clusterId.

    WrapperProperties.CLUSTER_ID.set(hostListProperties, `${this.bgdId}::${this.role.name}::${BlueGreenStatusMonitor.BG_CLUSTER_ID}`);

    logger.debug(Messages.get("Bgd.createHostListProvider", `${this.role.name}`, WrapperProperties.CLUSTER_ID.get(hostListProperties)));

    const connectionHostInfoCopy: HostInfo = this.connectionHostInfo;
    if (connectionHostInfoCopy) {
      this.hostListProvider = this.pluginService
        .getDialect()
        .getHostListProvider(hostListProperties, connectionHostInfoCopy.host, this.pluginService as unknown as HostListProviderService);
    } else {
      logger.warn(Messages.get("Bgd.hostInfoNull"));
    }
  }
}
