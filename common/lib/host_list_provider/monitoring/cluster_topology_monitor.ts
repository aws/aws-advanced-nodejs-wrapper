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

import { HostInfo } from "../../host_info";
import { PluginService } from "../../plugin_service";
import { HostAvailability } from "../../host_availability/host_availability";
import { convertMsToNanos, convertNanosToMs, getTimeInNanos, logTopology, sleep } from "../../utils/utils";
import { logger } from "../../../logutils";
import { HostRole } from "../../host_role";
import { ClientWrapper } from "../../client_wrapper";
import { AwsTimeoutError, AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { Topology } from "../topology";
import { StorageService } from "../../utils/storage/storage_service";
import { TopologyUtils } from "../topology_utils";
import { RdsUtils } from "../../utils/rds_utils";
import { AbstractMonitor, Monitor } from "../../utils/monitoring/monitor";
import { FullServicesContainer } from "../../utils/full_services_container";
import { HostListProvider } from "../host_list_provider";
import { HostListProviderService } from "../../host_list_provider_service";
import { Event, EventSubscriber } from "../../utils/events/event";
import { MonitorResetEvent } from "../../utils/events/monitor_reset_event";
import { ServiceUtils } from "../../utils/service_utils";

export interface ClusterTopologyMonitor extends Monitor, EventSubscriber {
  forceRefresh(client: ClientWrapper, timeoutMs: number): Promise<HostInfo[]>;

  close(): Promise<void>;

  /**
   * Initiates a topology update.
   *
   * @param verifyTopology defines whether extra measures should be taken to verify the topology. If false, the
   *                       method will return as soon as topology is successfully retrieved from any instance. If
   *                       true, extra steps are taken to verify the topology is accurate.
   * @param timeoutMs      timeout in msec to wait until the topology gets refreshed (if verifyWriter has a value of
   *                       <code>false</code>) or verified (if verifyTopology has a value of <code>true</code>).
   * @return true if successful, false if unsuccessful or the timeout is reached
   * @throws AwsWrapperError if wrapper timed out while fetching the topology.
   */
  forceMonitoringRefresh(verifyTopology: boolean, timeoutMs: number): Promise<HostInfo[]>;

  canDispose(): boolean;
}

export class ClusterTopologyMonitorImpl extends AbstractMonitor implements ClusterTopologyMonitor {
  private static readonly MONITOR_TERMINATION_TIMEOUT_SEC: number = 30;
  private static readonly STABLE_TOPOLOGIES_DURATION_NS: bigint = convertMsToNanos(15000); // 15 seconds.

  static readonly MONITORING_PROPERTY_PREFIX: string = "topology_monitoring_";

  private readonly clusterId: string;
  protected readonly initialHostInfo: HostInfo;
  private readonly servicesContainer: FullServicesContainer;
  private readonly _monitoringProperties: Map<string, any>;
  private readonly _pluginService: PluginService;
  private readonly _hostListProvider: HostListProvider | null;
  protected readonly hostListProviderService: HostListProviderService;
  private readonly refreshRateNs: number;
  private readonly highRefreshRateNs: number;
  private readonly storageService: StorageService;
  private readonly rdsUtils: RdsUtils = new RdsUtils();
  protected readonly instanceTemplate: HostInfo;

  private writerHostInfo: HostInfo = null;
  private isVerifiedWriterConnection: boolean = false;
  private monitoringClient: ClientWrapper = null;
  private highRefreshRateEndTimeNs: bigint = BigInt(0);

  public readonly topologyUtils: TopologyUtils;
  public readonly readerTopologiesById: Map<string, HostInfo[]> = new Map();
  public readonly completedOneCycle: Map<string, boolean> = new Map();
  // When comparing topologies, we don't want to check HostInfo.weight, which is used in HostInfo#equals.
  // We use this function to compare the other fields.
  protected readonly hostInfoExtractor = (host: HostInfo): string => {
    return `${host.host}:${host.port}:${host.availability}:${host.role}`;
  };

  // Tracking of the host monitors.
  private hostMonitors: Map<string, HostMonitor> = new Map();
  public hostMonitorsWriterClient = null;
  public hostMonitorsWriterInfo: HostInfo = null;
  public hostMonitorsReaderClient = null;
  public hostMonitorsLatestTopology: HostInfo[] = [];

  // Controls for stopping asynchronous monitoring tasks.
  private stopMonitoring: boolean = false;
  public hostMonitorsStop: boolean = false;
  private untrackedPromises: Promise<void>[] = [];

  // Signals to other methods that asynchronous tasks have completed/should be completed.
  private requestToUpdateTopology: boolean = false;
  private submittedHosts: Map<string, Promise<void>> = new Map();
  private hostTasksWriterClient: ClientWrapper | null;
  private hostTasksWriterHostInfo: HostInfo | null;
  private hostTasksLatestTopology: HostInfo[];
  private hostTasksReaderClient: ClientWrapper;
  private hostTasksStop: boolean = false;
  private stableTopologiesStartNs: bigint;

  constructor(
    servicesContainer: FullServicesContainer,
    topologyUtils: TopologyUtils,
    clusterId: string,
    initialHostInfo: HostInfo,
    props: Map<string, any>,
    instanceTemplate: HostInfo,
    refreshRateNs: number,
    highRefreshRateNs: number
  ) {
    super(ClusterTopologyMonitorImpl.MONITOR_TERMINATION_TIMEOUT_SEC);
    this.topologyUtils = topologyUtils;
    this.clusterId = clusterId;
    this.initialHostInfo = initialHostInfo;
    this.instanceTemplate = instanceTemplate;
    this.servicesContainer = servicesContainer;
    this.storageService = this.servicesContainer.getStorageService();
    this._pluginService = this.servicesContainer.getPluginService();
    this.hostListProviderService = this.servicesContainer.getHostListProviderService();
    this._hostListProvider = this.hostListProviderService.getHostListProvider();
    this.refreshRateNs = refreshRateNs;
    this.highRefreshRateNs = highRefreshRateNs;

    this._monitoringProperties = new Map<string, any>(props);
    for (const [key, val] of props) {
      if (key.startsWith(ClusterTopologyMonitorImpl.MONITORING_PROPERTY_PREFIX)) {
        this._monitoringProperties.set(key.substring(ClusterTopologyMonitorImpl.MONITORING_PROPERTY_PREFIX.length), val);
        this._monitoringProperties.delete(key);
      }
    }
    this.untrackedPromises.push(this.monitor());
  }

  get hostListProvider(): HostListProvider {
    return this._hostListProvider;
  }

  get pluginService(): PluginService {
    return this._pluginService;
  }

  get monitoringProperties(): Map<string, any> {
    return this._monitoringProperties;
  }

  async close(): Promise<void> {
    this.stopMonitoring = true;
    this.hostMonitorsStop = true;
    this.requestToUpdateTopology = true;
    // await Promise.all(this.untrackedPromises);
    // await Promise.all(this.submittedHosts.values());

    const monitoringClientToClose = this.monitoringClient;
    const hostMonitorsWriterClientToClose = this.hostMonitorsWriterClient;
    const hostMonitorsReaderClientToClose = this.hostMonitorsReaderClient;

    this.monitoringClient = null;
    this.hostMonitorsWriterClient = null;
    this.hostMonitorsReaderClient = null;

    await this.closeConnection(monitoringClientToClose);
    if (hostMonitorsWriterClientToClose && hostMonitorsWriterClientToClose !== monitoringClientToClose) {
      await this.closeConnection(hostMonitorsWriterClientToClose);
    }
    if (
      hostMonitorsReaderClientToClose &&
      hostMonitorsReaderClientToClose !== monitoringClientToClose &&
      hostMonitorsReaderClientToClose !== hostMonitorsWriterClientToClose
    ) {
      await this.closeConnection(hostMonitorsReaderClientToClose);
    }

    this.untrackedPromises = [];
    this.submittedHosts.clear();
    this.hostMonitors.clear();
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[] | null> {
    if (shouldVerifyWriter) {
      this.isVerifiedWriterConnection = false;
      if (this.monitoringClient) {
        const client = this.monitoringClient;
        this.monitoringClient = null;
        // Abort needed for MySQLClientWrapper in case client already closed.
        await this.closeConnection(client);
      }
    }

    return await this.waitTillTopologyGetsUpdated(timeoutMs);
  }

  async forceRefresh(client: ClientWrapper, timeoutMs: number): Promise<HostInfo[] | null> {
    if (this.isVerifiedWriterConnection) {
      // Get the monitoring thread to refresh the topology using a verified connection.
      return await this.waitTillTopologyGetsUpdated(timeoutMs);
    }

    // Otherwise, use the provided unverified connection to update the topology.
    return await this.fetchTopologyAndUpdateCache(client);
  }

  async waitTillTopologyGetsUpdated(timeoutMs: number): Promise<HostInfo[] | null> {
    // Notify the monitoring thread, which may be sleeping, that topology should be refreshed immediately.
    this.requestToUpdateTopology = true;

    const currentHosts: HostInfo[] = this.getStoredHosts();

    if (timeoutMs === 0) {
      logger.info(logTopology(currentHosts, Messages.get("ClusterTopologyMonitoring.timeoutSetToZero")));
      return currentHosts;
    }

    const endTime = Date.now() + timeoutMs;
    let latestHosts: HostInfo[];

    while ((latestHosts = this.getStoredHosts()) === currentHosts && Date.now() < endTime) {
      await sleep(1000);
    }

    if (Date.now() >= endTime) {
      throw new AwsTimeoutError(Messages.get("ClusterTopologyMonitor.timeoutError", timeoutMs.toString()));
    }
    return latestHosts;
  }

  async fetchTopologyAndUpdateCache(client: ClientWrapper): Promise<HostInfo[] | null> {
    if (!client) {
      return null;
    }

    try {
      const hosts: HostInfo[] = await this.queryForTopology(client);
      if (hosts) {
        this.updateTopologyCache(hosts);
      }
      return hosts;
    } catch (error: any) {
      logger.debug(Messages.get("ClusterTopologyMonitor.errorFetchingTopology", error?.message));
    }
    return null;
  }

  private async openAnyClientAndUpdateTopology(): Promise<HostInfo[] | null> {
    if (!this.monitoringClient) {
      let client: ClientWrapper;
      try {
        client = await this.servicesContainer.getPluginService().forceConnect(this.initialHostInfo, this._monitoringProperties);
      } catch {
        // Unable to connect to host;
        return null;
      }

      if (client && this.monitoringClient === null) {
        this.monitoringClient = client;
        logger.debug(Messages.get("ClusterTopologyMonitor.openedMonitoringConnection", this.initialHostInfo.host));
        try {
          if (await this.topologyUtils.isWriterInstance(this.monitoringClient)) {
            this.isVerifiedWriterConnection = true;

            if (this.rdsUtils.isRdsInstance(this.initialHostInfo.host)) {
              this.writerHostInfo = this.initialHostInfo;
              logger.info(Messages.get("ClusterTopologyMonitor.writerMonitoringConnection", this.writerHostInfo.host));
            } else {
              const pair: [string, string] = await this.topologyUtils.getInstanceId(this.monitoringClient);
              const instanceTemplate: HostInfo = await this.getInstanceTemplate(pair[1], this.monitoringClient);
              this.writerHostInfo = this.topologyUtils.createHost(pair[0], pair[1], true, 0, Date.now(), this.initialHostInfo, instanceTemplate);
              logger.debug(Messages.get("ClusterTopologyMonitor.writerMonitoringConnection", this.writerHostInfo.host));
            }
          }
        } catch (error) {
          // Do nothing.
          logger.error(Messages.get("ClusterTopologyMonitor.invalidWriterQuery", error?.message));
        }
      } else if (client) {
        // Monitoring connection already set by another task, close the new connection.
        await this.closeConnection(client);
      }
    }

    const hosts: HostInfo[] = await this.fetchTopologyAndUpdateCache(this.monitoringClient);

    if (hosts === null) {
      this.isVerifiedWriterConnection = false;
      await this.updateMonitoringClient(null);
    }
    return hosts;
  }

  protected getInstanceTemplate(hostId: string, targetClient: ClientWrapper): Promise<HostInfo> {
    return Promise.resolve(this.instanceTemplate);
  }

  queryForTopology(client: ClientWrapper): Promise<HostInfo[]> {
    return this.topologyUtils.queryForTopology(client, this.pluginService.getDialect(), this.initialHostInfo, this.instanceTemplate);
  }

  updateHostsAvailability(hosts: HostInfo[]): HostInfo[] {
    if (!hosts) {
      return;
    }

    hosts.forEach((host) => {
      host.setAvailability(this.readerTopologiesById.has(host.hostId) ? HostAvailability.AVAILABLE : HostAvailability.NOT_AVAILABLE);
    });
  }

  updateTopologyCache(hosts: HostInfo[]): void {
    this.storageService.set(this.clusterId, new Topology(hosts));
    this.requestToUpdateTopology = false;
  }

  protected clearTopologyCache(): void {
    this.servicesContainer.getStorageService().remove(Topology, this.clusterId);
  }

  async closeConnection(client: ClientWrapper): Promise<void> {
    if (client !== null) {
      await client.abort();
      client = null;
    }
  }

  async updateMonitoringClient(newClient: ClientWrapper | null): Promise<void> {
    const clientToClose = this.monitoringClient;
    this.monitoringClient = newClient;
    if (clientToClose) {
      await clientToClose.abort();
    }
  }

  async stop(): Promise<void> {
    this._stop = true;
    this.hostTasksStop = true;
    this.stopMonitoring = true;
    this.hostMonitorsStop = true;

    await Promise.all(this.untrackedPromises);
    await Promise.all(this.submittedHosts.values());

    await this.closeHostMonitors();

    const hostTasksWriterClientToClose = this.hostTasksWriterClient;
    const hostTasksReaderClientToClose = this.hostTasksReaderClient;
    const monitoringClientToClose = this.monitoringClient;

    this.hostTasksWriterClient = null;
    this.hostTasksReaderClient = null;
    this.monitoringClient = null;

    await this.closeConnection(hostTasksWriterClientToClose);
    if (hostTasksReaderClientToClose && hostTasksReaderClientToClose !== hostTasksWriterClientToClose) {
      await this.closeConnection(hostTasksReaderClientToClose);
    }
    if (
      monitoringClientToClose &&
      monitoringClientToClose !== hostTasksWriterClientToClose &&
      monitoringClientToClose !== hostTasksReaderClientToClose
    ) {
      await this.closeConnection(monitoringClientToClose);
    }

    this.untrackedPromises = [];
    this.submittedHosts.clear();
    this.hostMonitors.clear();

    return super.stop();
  }

  async monitor(): Promise<void> {
    try {
      logger.debug(Messages.get("ClusterTopologyMonitor.startMonitoring", this.clusterId, this.initialHostInfo.host));
      this.servicesContainer.getEventPublisher().subscribe(this, new Set([MonitorResetEvent]));

      while (!this._stop) {
        this.lastActivityTimestampNanos = getTimeInNanos();

        if (this.isInPanicMode()) {
          if (this.submittedHosts.size === 0) {
            logger.debug(Messages.get("ClusterTopologyMonitor.startingHostMonitoringTasks"));

            // Start host monitoring tasks.
            this.hostTasksStop = false;
            await this.hostTaskClientCleanUp();
            this.hostTasksWriterHostInfo = null;
            this.hostTasksLatestTopology = null;

            let hosts: HostInfo[] = this.getStoredHosts();
            if (hosts === null) {
              // Use any available connection to get the topology.
              hosts = await this.openAnyClientAndUpdateTopology();
            }

            await this.closeHostMonitors();

            if (!(hosts !== null && !this.isVerifiedWriterConnection)) {
              continue;
            }

            hosts.forEach(async (hostInfo) => {
              if (!this.submittedHosts.get(hostInfo.host)) {
                const minimalServiceContainer = ServiceUtils.instance.createMinimalServiceContainerFrom(
                  this.servicesContainer,
                  this._monitoringProperties
                );
                await minimalServiceContainer.getPluginManager().init();
                const hostMonitor = new HostMonitor(minimalServiceContainer, this, hostInfo, this.writerHostInfo);
                this.submittedHosts.set(hostInfo.host, hostMonitor.run());
                this.hostMonitors.set(hostInfo.host, hostMonitor);
              }
            });

            // We will try again in the next iteration.
          } else {
            // The host monitors are running, so we check if the writer has been detected.
            const writerClient: ClientWrapper | null = this.hostTasksWriterClient;
            const writerClientHostInfo: HostInfo = this.hostTasksWriterHostInfo;

            if (writerClient !== null && writerClientHostInfo !== null) {
              logger.debug(Messages.get("ClusterTopologyMonitor.writerPickedUpFromHostMonitors", writerClientHostInfo.toString()));

              this.monitoringClient = writerClient;
              this.writerHostInfo = writerClientHostInfo;
              this.isVerifiedWriterConnection = true;
              this.highRefreshRateEndTimeNs = getTimeInNanos() + this.highRefreshRateEndTimeNs;

              this.hostTasksStop = true;
              await this.closeHostMonitors();
              this.submittedHosts.clear();
              this.stableTopologiesStartNs = BigInt(0);
              this.readerTopologiesById.clear();
              this.completedOneCycle.clear();

              continue;
            } else {
              // Update host monitors with the new instances in the topology.
              const hosts: HostInfo[] = this.hostTasksLatestTopology;
              if (hosts !== null && !this.hostTasksStop) {
                hosts.forEach((hostInfo) => {
                  if (!this.submittedHosts.get(hostInfo.host)) {
                    const hostMonitor = new HostMonitor(this.servicesContainer, this, hostInfo, this.writerHostInfo);
                    this.submittedHosts.set(hostInfo.host, hostMonitor.run());
                  }
                });
              }
            }
          }

          this.checkForStableReaderTopologies();
          await this.delay(true);
        } else {
          // We are in regular mode.
          if (this.submittedHosts.size !== 0) {
            await this.closeHostMonitors();
            this.submittedHosts.clear();
            this.stableTopologiesStartNs = BigInt(0);
            this.readerTopologiesById.clear();
            this.completedOneCycle.clear();
          }

          const hosts: HostInfo[] = await this.fetchTopologyAndUpdateCache(this.monitoringClient);
          if (hosts === null) {
            // Attempt to fetch topology failed, so we switch to panic mode.
            this.monitoringClient = null;
            this.isVerifiedWriterConnection = false;
            this.writerHostInfo = null;
            continue;
          }

          if (this.highRefreshRateEndTimeNs > 0 && getTimeInNanos() > this.highRefreshRateEndTimeNs) {
            this.highRefreshRateEndTimeNs = BigInt(0);
          }

          // We avoid logging the topology while using the high refresh rate because it is too noisy.
          if (this.highRefreshRateEndTimeNs === BigInt(0)) {
            logger.debug(logTopology(this.getStoredHosts(), ""));
          }

          await this.delay(false);
        }
      }
    } finally {
      this._stop = true;
      await this.closeHostMonitors();
      await this.hostTaskClientCleanUp();

      this.servicesContainer.getEventPublisher().unsubscribe(this, new Set([MonitorResetEvent]));

      logger.debug(Messages.get("ClusterTopologyMonitor.stopHostMonitoringTask", this.initialHostInfo.host));
    }

    return Promise.resolve();
  }

  protected checkForStableReaderTopologies(): void {
    const latestHosts: HostInfo[] = this.getStoredHosts();
    if (!latestHosts || latestHosts.length === 0) {
      this.stableTopologiesStartNs = BigInt(0);
      return;
    }

    const readerIds: string[] = latestHosts.map((host) => host.hostId);
    for (const id of readerIds) {
      const completedCycle = this.completedOneCycle.get(id) ?? false;
      if (!completedCycle) {
        // Not all reader monitors have completed a cycle. We shouldn't conclude that reader topologies are stable until
        // each reader monitor has made at least one attempt to fetch topology information, even if unsuccessful.
        this.stableTopologiesStartNs = BigInt(0);
        return;
      }
    }

    const readerTopologyValues = Array.from(this.readerTopologiesById.values());
    const readerTopology: HostInfo[] | undefined = readerTopologyValues.length > 0 ? readerTopologyValues[0] : undefined;
    if (!readerTopology) {
      // readerTopologiesById has been cleared since checking its size.
      this.stableTopologiesStartNs = BigInt(0);
      return;
    }

    // Check whether the topologies match. HostInfos are compared using their host, port, role, and availability fields.
    // Using the first HostInfo in the topology as the reference.
    // Note that monitors that encounter errors will remove their entry from the map, so only entries from
    // successful monitors are checked.
    const reference = JSON.stringify(readerTopology.map(this.hostInfoExtractor).sort());
    const allTopologiesMatch = readerTopologyValues.every((hosts) => JSON.stringify(hosts.map(this.hostInfoExtractor).sort()) === reference);

    if (!allTopologiesMatch) {
      // The topologies detected by each reader do not match.
      this.stableTopologiesStartNs = BigInt(0);
      return;
    }

    // All reader topologies match.
    if (this.stableTopologiesStartNs === BigInt(0)) {
      this.stableTopologiesStartNs = getTimeInNanos();
    }

    if (getTimeInNanos() > this.stableTopologiesStartNs + ClusterTopologyMonitorImpl.STABLE_TOPOLOGIES_DURATION_NS) {
      // Reader topologies have been consistent for STABLE_TOPOLOGIES_DURATION_NS, so the topology should be accurate.
      this.stableTopologiesStartNs = BigInt(0);
      this.updateHostsAvailability(readerTopology);
      logger.debug(
        logTopology(
          readerTopology,
          Messages.get(
            "ClusterTopologyMonitor.matchingReaderTopologies",
            String(convertNanosToMs(ClusterTopologyMonitorImpl.STABLE_TOPOLOGIES_DURATION_NS))
          )
        )
      );
      this.updateTopologyCache(readerTopology);
    }
  }

  protected async reset(): Promise<void> {
    logger.debug(Messages.get("ClusterTopologyMonitor.reset", this.clusterId, this.initialHostInfo.host));

    this.hostMonitorsStop = true;
    await this.closeHostMonitors();
    await this.hostTaskClientCleanUp();
    this.hostMonitorsStop = false;
    this.submittedHosts.clear();
    this.stableTopologiesStartNs = BigInt(0);
    this.readerTopologiesById.clear();
    this.completedOneCycle.clear();

    this.hostTasksWriterHostInfo = null;
    this.hostTasksLatestTopology = [];

    await this.updateMonitoringClient(null);
    this.isVerifiedWriterConnection = false;
    this.writerHostInfo = null;
    this.highRefreshRateEndTimeNs = BigInt(0);
    this.requestToUpdateTopology = false;
    this.clearTopologyCache();

    // This breaks any waiting/sleeping cycles in the monitoring task.
    this.requestToUpdateTopology = true;
  }

  async processEvent(event: Event): Promise<void> {
    if (event instanceof MonitorResetEvent) {
      logger.debug(Messages.get("ClusterTopologyMonitor.resetEventReceived"));
      const resetEvent = event as MonitorResetEvent;
      if (resetEvent.clusterId === this.clusterId) {
        await this.reset();
      }
    }
  }

  protected async hostTaskClientCleanUp(): Promise<void> {
    const writerClientToClose = this.hostTasksWriterClient;
    const readerClientToClose = this.hostTasksReaderClient;

    this.hostTasksWriterClient = null;
    this.hostTasksReaderClient = null;

    if (writerClientToClose && this.monitoringClient !== writerClientToClose) {
      try {
        await this.closeConnection(writerClientToClose);
      } catch (e: any) {
        // Ignore
      }
    }

    if (readerClientToClose && this.monitoringClient !== readerClientToClose && writerClientToClose !== readerClientToClose) {
      try {
        await this.closeConnection(readerClientToClose);
      } catch (e: any) {
        // Ignore
      }
    }
  }

  protected async closeHostMonitors(): Promise<void> {
    await Promise.all(this.submittedHosts.values());
    this.submittedHosts.clear();
    await this.hostTaskClientCleanUp();
  }

  private isInPanicMode(): boolean {
    return !this.monitoringClient || !this.isVerifiedWriterConnection;
  }

  private getStoredHosts(): HostInfo[] | null {
    const topology = this.storageService.get(Topology, this.clusterId);
    return topology == null ? null : topology.hosts;
  }

  private async delay(useHighRefreshRate: boolean): Promise<void> {
    if (getTimeInNanos() < this.highRefreshRateEndTimeNs) {
      useHighRefreshRate = true;
    }
    const delayNs = useHighRefreshRate ? this.highRefreshRateNs : this.refreshRateNs;
    const endTime: bigint = getTimeInNanos() + BigInt(delayNs);
    await sleep(50);
    while (getTimeInNanos() < endTime && !this.requestToUpdateTopology && !this._stop) {
      await sleep(50);
    }
  }
}

export class HostMonitor {
  private static readonly INITIAL_BACKOFF_MS = 100;
  private static readonly MAX_BACKOFF_MS = 10000;

  protected readonly servicesContainer: FullServicesContainer;
  protected readonly monitor: ClusterTopologyMonitorImpl;
  protected readonly hostInfo: HostInfo;
  protected readonly writerHostInfo: HostInfo;
  protected writerChanged: boolean = false;
  protected connectionAttempts: number = 0;
  protected client: ClientWrapper | null = null;

  constructor(servicesContainer: FullServicesContainer, monitor: ClusterTopologyMonitorImpl, hostInfo: HostInfo, writerHostInfo: HostInfo) {
    this.servicesContainer = servicesContainer;
    this.monitor = monitor;
    this.hostInfo = hostInfo;
    this.writerHostInfo = writerHostInfo;
  }

  async run() {
    let updateTopology: boolean = false;
    const startTime: number = Date.now();
    logger.debug(Messages.get("HostMonitor.startMonitoring", this.hostInfo.hostId));
    const pluginService = this.servicesContainer.getPluginService();
    try {
      while (!this.monitor.hostMonitorsStop) {
        if (!this.client) {
          try {
            this.client = await pluginService.forceConnect(this.hostInfo, this.monitor.monitoringProperties);
            this.connectionAttempts = 0;
          } catch (error) {
            // A problem occurred while connecting.
            if (pluginService.isNetworkError(error)) {
              // It's a network issue that's expected during a cluster failover.
              // We will try again on the next iteration.
              await sleep(100);
              this.monitor.completedOneCycle.set(this.hostInfo.hostId, true);
              this.monitor.readerTopologiesById.delete(this.hostInfo.hostId);
              continue;
            } else if (pluginService.isLoginError(error)) {
              throw new AwsWrapperError("Login error detected during monitoring.", error);
            } else {
              // It might be some transient error. Let's try again.
              // If the error repeats, we will try again after a longer delay.
              await sleep(this.calculateBackoffWithJitter(this.connectionAttempts++));
              this.monitor.completedOneCycle.set(this.hostInfo.hostId, true);
              this.monitor.readerTopologiesById.delete(this.hostInfo.hostId);
              continue;
            }
          }
        }

        if (this.client) {
          let isWriter: boolean;
          try {
            isWriter = await this.monitor.topologyUtils.isWriterInstance(this.client);
          } catch (error) {
            logger.error(Messages.get("ClusterTopologyMonitor.invalidWriterQuery", error?.message));
            await this.monitor.closeConnection(this.client);
            this.client = null;
          }

          if (isWriter) {
            try {
              // First connection after failover may be stale.
              if ((await this.monitor.pluginService.getHostRole(this.client)) !== HostRole.WRITER) {
                isWriter = false;
              }
            } catch (error: any) {
              // Invalid connection, retry.
              this.monitor.completedOneCycle.set(this.hostInfo.hostId, true);
              this.monitor.readerTopologiesById.delete(this.hostInfo.hostId);
              continue;
            }
          }

          if (isWriter) {
            // This prevents us from closing the connection in the finally block.
            if (this.monitor.hostMonitorsWriterClient !== null) {
              // The writer connection is already set up, probably by another host monitor.
              await this.monitor.closeConnection(this.client);
            } else {
              // Successfully updated the host monitor writer connection.
              logger.debug(Messages.get("HostMonitor.detectedWriter", this.hostInfo.hostId, this.hostInfo.url));

              this.servicesContainer
                .getImportantEventService()
                .registerEvent(() => Messages.get("HostMonitor.detectedWriter", this.hostInfo.hostId, this.hostInfo.url));

              await this.monitor.fetchTopologyAndUpdateCache(this.client);
              this.hostInfo.setAvailability(HostAvailability.AVAILABLE);
              this.monitor.hostMonitorsWriterClient = this.client;
              this.monitor.hostMonitorsWriterInfo = this.hostInfo;
              // Connection is already assigned to this.monitor.hostMonitorsWriterClient
              // so we need to reset client without closing it.
              this.client = null;
              this.monitor.hostMonitorsStop = true;
              logger.debug(logTopology(this.monitor.hostMonitorsLatestTopology, `[hostMonitor ${this.hostInfo.hostId}] `));
            }
            return;
          } else if (this.client) {
            // Client is a reader.
            if (!this.monitor.hostMonitorsWriterClient) {
              // We can use this reader connection to update the topology while we wait for the writer connection to
              // be established.
              if (updateTopology) {
                await this.readerTaskFetchTopology(this.client, this.writerHostInfo);
              } else if (this.monitor.hostMonitorsReaderClient === null) {
                this.monitor.hostMonitorsReaderClient = this.client;
                updateTopology = true;
                await this.readerTaskFetchTopology(this.client, this.writerHostInfo);
              } else {
                await this.readerTaskFetchTopology(this.client, this.writerHostInfo);
              }
            }
          }
        }

        this.monitor.completedOneCycle.set(this.hostInfo.hostId, true);
        await sleep(100);
      }
    } catch (error) {
      // Close the monitor.
    } finally {
      this.monitor.completedOneCycle.set(this.hostInfo.hostId, true);
      this.monitor.readerTopologiesById.delete(this.hostInfo.hostId);

      await this.monitor.closeConnection(this.client);
      logger.debug(Messages.get("HostMonitor.endMonitoring", this.hostInfo.hostId, (Date.now() - startTime).toString()));
    }
  }

  private async readerTaskFetchTopology(client: any, writerHostInfo: HostInfo) {
    if (!client) {
      return;
    }

    let hosts: HostInfo[];
    try {
      hosts = await this.monitor.queryForTopology(client);
      if (hosts === null) {
        return;
      }
    } catch (error) {
      return;
    }

    // Share this topology so that the main monitoring thread can adjust the node monitoring threads.
    this.monitor.hostMonitorsLatestTopology = hosts;
    this.monitor.readerTopologiesById.set(this.hostInfo.hostId, hosts);

    if (this.writerChanged) {
      this.monitor.updateHostsAvailability(hosts);
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, `[hostMonitor ${this.hostInfo.hostId}] `));
      return;
    }

    const latestWriterHostInfo: HostInfo = hosts.find((x) => x.role === HostRole.WRITER);
    if (latestWriterHostInfo && writerHostInfo && latestWriterHostInfo.hostAndPort !== writerHostInfo.hostAndPort) {
      this.writerChanged = true;
      logger.debug(Messages.get("HostMonitor.writerHostChanged", writerHostInfo.hostAndPort, latestWriterHostInfo.hostAndPort));
      this.monitor.updateHostsAvailability(hosts);
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, `[hostMonitor ${this.hostInfo.hostId}] `));
    }
  }

  private calculateBackoffWithJitter(attempt: number): number {
    let backoff = HostMonitor.INITIAL_BACKOFF_MS * Math.round(Math.pow(2, Math.min(attempt, 6)));
    backoff = Math.min(backoff, HostMonitor.MAX_BACKOFF_MS);
    return Math.round(backoff * (0.5 + Math.random() * 0.5));
  }
}
