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
import { HostListProviderService } from "../../host_list_provider_service";
import { Event, EventSubscriber } from "../../utils/events/event";
import { MonitorResetEvent } from "../../utils/events/monitor_reset_event";
import { ServiceUtils } from "../../utils/service_utils";
import { WrapperProperties } from "../../wrapper_property";
import { MonitoringConnectionHandler } from "./monitoring_connection_handler";
import { AuroraMonitoringConnectionHandler } from "./aurora_monitoring_connection_handler";

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
  protected static readonly DEFAULT_CONNECTION_TIMEOUT_MS: number = 5000;
  protected static readonly DEFAULT_QUERY_TIMEOUT_MS: number = 5000;

  private readonly clusterId: string;
  protected readonly initialHostInfo: HostInfo;
  private readonly servicesContainer: FullServicesContainer;
  private readonly _monitoringProperties: Map<string, any>;
  private readonly _pluginService: PluginService;
  protected readonly hostListProviderService: HostListProviderService;
  private readonly refreshRateNs: number;
  private readonly highRefreshRateNs: number;
  private readonly storageService: StorageService;
  private readonly rdsUtils: RdsUtils = new RdsUtils();
  protected readonly instanceTemplate: HostInfo;
  protected connectionHandler: MonitoringConnectionHandler | null = null;

  protected writerHostInfo: HostInfo | null = null;
  protected lastKnownWriterHostInfo: HostInfo | null = null;
  protected monitoringClient: ClientWrapper | null = null;
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
  public hostMonitorsWriterClient = null;
  public hostMonitorsWriterInfo: HostInfo = null;
  public hostMonitorsReaderClient = null;
  public hostMonitorsLatestTopology: HostInfo[] = [];

  // Connections harvested from host monitors as they stop, keyed by host. When the writer resides in
  // an inaccessible region (someRegionsInaccessible), no host monitor can obtain a verified writer
  // connection, so the main loop adopts one of these (reader) connections as the monitoring connection
  // to exit panic mode. Populated by HostMonitor.run()'s finally block via harvestConnection().
  public hostMonitorsHarvestedConnections: Map<HostInfo, ClientWrapper> = new Map();
  // True when the most recently submitted set of host monitors excluded one or more hosts because they
  // fell outside the accessible regions. Gates reader-consensus panic exit so the standard writer
  // detection path is left untouched when all regions are accessible.
  public hostMonitorsSomeRegionsInaccessible: boolean = false;
  // Set by a HostMonitor when, with some regions inaccessible, a reader observes that the writer has
  // changed. No host monitor can connect to the new writer to verify it, so a reader-observed change is
  // the only fast signal to exit panic mode. Prompts the main loop to adopt a harvested reader connection
  // without waiting for the full stable-topology window.
  public hostMonitorsReaderConsensusRequested: boolean = false;

  // Controls for stopping asynchronous monitoring tasks.
  public hostMonitorsStop: boolean = false;

  // Signals to other methods that asynchronous tasks have completed/should be completed.
  private requestToUpdateTopology: boolean = false;
  private submittedHosts: Map<string, Promise<void>> = new Map();
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
    this.storageService = this.servicesContainer.storageService;
    this._pluginService = this.servicesContainer.pluginService;
    this.hostListProviderService = this.servicesContainer.hostListProviderService;
    this.refreshRateNs = refreshRateNs;
    this.highRefreshRateNs = highRefreshRateNs;

    this._monitoringProperties = new Map<string, any>(props);
    for (const [key, val] of props) {
      if (key.startsWith(WrapperProperties.TOPOLOGY_MONITORING_PROPERTY_PREFIX)) {
        this._monitoringProperties.set(key.substring(WrapperProperties.TOPOLOGY_MONITORING_PROPERTY_PREFIX.length), val);
        this._monitoringProperties.delete(key);
      }
    }

    const connectTimeout =
      this._monitoringProperties.get(WrapperProperties.WRAPPER_CONNECT_TIMEOUT.name) ?? ClusterTopologyMonitorImpl.DEFAULT_CONNECTION_TIMEOUT_MS;
    const queryTimeout =
      this._monitoringProperties.get(WrapperProperties.WRAPPER_QUERY_TIMEOUT.name) ?? ClusterTopologyMonitorImpl.DEFAULT_QUERY_TIMEOUT_MS;
    const driverDialect = this._pluginService.getDriverDialect();
    driverDialect.setConnectTimeout(this._monitoringProperties, connectTimeout);
    driverDialect.setQueryTimeout(this._monitoringProperties, undefined, queryTimeout);
  }

  protected getConnectionHandler(): MonitoringConnectionHandler {
    if (this.connectionHandler === null) {
      this.connectionHandler = this.createConnectionHandler();
    }
    return this.connectionHandler;
  }

  protected createConnectionHandler(): MonitoringConnectionHandler {
    return new AuroraMonitoringConnectionHandler(
      this._pluginService,
      this._monitoringProperties,
      () => this.monitoringClient,
      (client) => {
        this.monitoringClient = client;
      }
    );
  }

  get pluginService(): PluginService {
    return this._pluginService;
  }

  get monitoringProperties(): Map<string, any> {
    return this._monitoringProperties;
  }

  async close(): Promise<void> {
    this.hostMonitorsStop = true;
    this.requestToUpdateTopology = true;
    await Promise.all(this.submittedHosts.values());

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

    await this.cleanUpHarvestedConnections();
    this.submittedHosts.clear();
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[] | null> {
    if (shouldVerifyWriter) {
      const client = this.monitoringClient;
      this.monitoringClient = null;
      if (client) {
        await this.closeConnection(client);
      }
    }

    return await this.waitTillTopologyGetsUpdated(timeoutMs);
  }

  async forceRefresh(client: ClientWrapper, timeoutMs: number): Promise<HostInfo[] | null> {
    if (this.monitoringClient) {
      // Get the monitoring task to refresh the topology using the monitoring connection.
      return await this.waitTillTopologyGetsUpdated(timeoutMs);
    }

    // Otherwise, use the provided connection to update the topology.
    return await this.fetchTopologyAndUpdateCache(client);
  }

  async waitTillTopologyGetsUpdated(timeoutMs: number): Promise<HostInfo[] | null> {
    // Notify the monitoring task, which may be sleeping, that topology should be refreshed immediately.
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

  protected async openAnyClientAndUpdateTopology(): Promise<HostInfo[] | null> {
    if (!this.monitoringClient) {
      let client: ClientWrapper;
      try {
        client = await this.servicesContainer.pluginService.forceConnect(this.initialHostInfo, this._monitoringProperties);
      } catch (connectError) {
        // Unable to connect to host.
        return null;
      }

      logger.debug(Messages.get("ClusterTopologyMonitor.openedMonitoringConnection", this.initialHostInfo.host));

      let isWriter = false;
      try {
        isWriter = await this.topologyUtils.isWriterInstance(client);
      } catch (error) {
        // Do nothing — assume not a writer.
      }

      if (isWriter) {
        try {
          if (this.rdsUtils.isRdsInstance(this.initialHostInfo.host)) {
            this.writerHostInfo = this.initialHostInfo;
            this.lastKnownWriterHostInfo = this.initialHostInfo;
            logger.info(Messages.get("ClusterTopologyMonitor.writerMonitoringConnection", this.writerHostInfo.host));
          } else {
            const pair: [string, string] = await this.topologyUtils.getInstanceId(client);
            const instanceTemplate: HostInfo = await this.getInstanceTemplate(pair[1], client);
            this.writerHostInfo = this.topologyUtils.createHost(pair[0], pair[1], true, 0, Date.now(), this.initialHostInfo, instanceTemplate);
            this.lastKnownWriterHostInfo = this.writerHostInfo;
            logger.debug(Messages.get("ClusterTopologyMonitor.writerMonitoringConnection", this.writerHostInfo.host));
          }
        } catch (error) {
          // Do nothing.
        }
      }

      // Offer the connection to the handler. If rejected, close it.
      if (!this.getConnectionHandler().acceptConnection(client, isWriter, this.initialHostInfo)) {
        await this.closeConnection(client);
      }
    }

    const hosts: HostInfo[] = await this.fetchTopologyAndUpdateCache(this.monitoringClient);

    if (hosts === null) {
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

  updateHostsAvailability(hosts: HostInfo[]): void {
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
    this.servicesContainer.storageService.remove(Topology, this.clusterId);
  }

  async closeConnection(client: ClientWrapper | null): Promise<void> {
    await client?.abort();
  }

  isMonitoringClient(client: ClientWrapper): boolean {
    return client === this.monitoringClient;
  }

  get isStopped(): boolean {
    return this._stop;
  }

  /**
   * Adopts ownership of a live connection handed off by a stopping HostMonitor, storing it in the harvest map
   * so the main loop can promote one as the monitoring connection during reader-consensus panic exit. If an
   * entry already exists for the host, the previous connection is closed to avoid a leak.
   *
   * @param hostInfo the host the connection belongs to
   * @param client the live connection being handed off
   */
  harvestConnection(hostInfo: HostInfo, client: ClientWrapper): void {
    const previous = this.hostMonitorsHarvestedConnections.get(hostInfo);
    this.hostMonitorsHarvestedConnections.set(hostInfo, client);
    if (previous && previous !== client) {
      // Should not normally happen, but clean up any previous entry to avoid leaks.
      void this.closeConnection(previous);
    }
  }

  async updateMonitoringClient(newClient: ClientWrapper | null): Promise<void> {
    const clientToClose = this.monitoringClient;
    this.monitoringClient = newClient;
    await clientToClose?.abort();
  }

  async stop(): Promise<void> {
    this._stop = true;
    this.hostMonitorsStop = true;

    await Promise.all(this.submittedHosts.values());

    await this.closeHostMonitors();

    const hostMonitorsWriterClientToClose = this.hostMonitorsWriterClient;
    const hostMonitorsReaderClientToClose = this.hostMonitorsReaderClient;
    const monitoringClientToClose = this.monitoringClient;

    this.hostMonitorsWriterClient = null;
    this.hostMonitorsReaderClient = null;
    this.monitoringClient = null;

    await this.closeConnection(hostMonitorsWriterClientToClose);
    if (hostMonitorsReaderClientToClose && hostMonitorsReaderClientToClose !== hostMonitorsWriterClientToClose) {
      await this.closeConnection(hostMonitorsReaderClientToClose);
    }
    if (
      monitoringClientToClose &&
      monitoringClientToClose !== hostMonitorsWriterClientToClose &&
      monitoringClientToClose !== hostMonitorsReaderClientToClose
    ) {
      await this.closeConnection(monitoringClientToClose);
    }

    await this.cleanUpHarvestedConnections();
    this.submittedHosts.clear();

    return super.stop();
  }

  async monitor(): Promise<void> {
    try {
      logger.debug(Messages.get("ClusterTopologyMonitor.startMonitoring", this.clusterId, this.initialHostInfo.host));
      this.servicesContainer.eventPublisher.subscribe(this, new Set([MonitorResetEvent]));

      while (!this._stop) {
        this.lastActivityTimestampNanos = getTimeInNanos();

        if (this.isInPanicMode()) {
          if (this.submittedHosts.size === 0) {
            logger.debug(Messages.get("ClusterTopologyMonitor.startingHostMonitoringTasks"));

            // Start host monitoring tasks.
            this.hostMonitorsStop = false;
            await this.hostMonitorClientCleanUp();
            this.hostMonitorsWriterInfo = null;
            this.hostMonitorsLatestTopology = [];

            let hosts: HostInfo[] = this.getStoredHosts();
            if (hosts === null) {
              // Use any available connection to get the topology.
              hosts = await this.openAnyClientAndUpdateTopology();
            }

            await this.closeHostMonitors();

            if (hosts === null || this.monitoringClient !== null) {
              await this.delay(true);
              continue;
            }

            const monitoredHosts = this.filterHostsForHostMonitoring(hosts);
            const someRegionsInaccessible: boolean = monitoredHosts.length < hosts.length;
            this.hostMonitorsSomeRegionsInaccessible = someRegionsInaccessible;
            const baselineWriter: HostInfo = this.lastKnownWriterHostInfo;
            for (const hostInfo of monitoredHosts) {
              if (!this.submittedHosts.get(hostInfo.host)) {
                const minimalServiceContainer = ServiceUtils.instance.createMinimalServiceContainerFrom(
                  this.servicesContainer,
                  this._monitoringProperties
                );
                await minimalServiceContainer.pluginManager.init();
                const hostMonitor = new HostMonitor(minimalServiceContainer, this, hostInfo, baselineWriter, someRegionsInaccessible);
                const promise = hostMonitor.run();
                this.submittedHosts.set(hostInfo.host, promise);
              }
            }

            // We will try again in the next iteration.
          } else {
            // The host monitors are running, so we check if the writer has been detected.
            const writerClient: ClientWrapper | null = this.hostMonitorsWriterClient;
            const writerClientHostInfo: HostInfo | null = this.hostMonitorsWriterInfo;

            if (writerClient && writerClientHostInfo) {
              logger.debug(Messages.get("ClusterTopologyMonitor.writerPickedUpFromHostMonitors", writerClientHostInfo.toString()));

              const oldMonitoringClient = this.monitoringClient;

              this.hostMonitorsWriterClient = null;
              this.hostMonitorsWriterInfo = null;
              this.monitoringClient = null;
              if (!this.getConnectionHandler().acceptConnection(writerClient, true, writerClientHostInfo)) {
                // Should not happen — the handler always accepts when there is no current monitoring client.
                // Fall back to the writer connection so we still exit panic mode.
                this.monitoringClient = writerClient;
              }
              this.writerHostInfo = writerClientHostInfo;
              this.lastKnownWriterHostInfo = writerClientHostInfo;
              this.highRefreshRateEndTimeNs = getTimeInNanos() + BigInt(this.highRefreshRateNs);

              this.hostMonitorsStop = true;
              await this.closeHostMonitors();

              // A verified writer connection was promoted, so any connections harvested from host monitors
              // during this panic cycle are no longer needed. Close them (skipping the current monitoring
              // client) to avoid leaking sockets.
              await this.cleanUpHarvestedConnections();

              this.submittedHosts.clear();
              this.stableTopologiesStartNs = BigInt(0);
              this.readerTopologiesById.clear();
              this.completedOneCycle.clear();

              // Close the old monitoring client that was replaced by the new writer client.
              if (oldMonitoringClient && oldMonitoringClient !== this.monitoringClient) {
                await this.closeConnection(oldMonitoringClient);
              }

              await this.delay(true);
              continue;
            } else if (
              this.hostMonitorsReaderConsensusRequested &&
              (await this.adoptHarvestedMonitoringConnection(this.hostMonitorsLatestTopology ?? this.getStoredHosts() ?? []))
            ) {
              // A reader observed a writer change while the writer is in an inaccessible region. We adopted a
              // harvested reader connection as the monitoring connection to exit panic mode.
              await this.delay(true);
              continue;
            } else {
              // Update host monitors with the new instances in the topology.
              const hosts: HostInfo[] | null = this.hostMonitorsLatestTopology;
              if (hosts && !this.hostMonitorsStop) {
                const monitoredHosts = this.filterHostsForHostMonitoring(hosts);
                const someRegionsInaccessible: boolean = monitoredHosts.length < hosts.length;
                this.hostMonitorsSomeRegionsInaccessible = someRegionsInaccessible;
                const baselineWriter: HostInfo = this.lastKnownWriterHostInfo;

                for (const hostInfo of monitoredHosts) {
                  if (!this.submittedHosts.get(hostInfo.host)) {
                    const minimalServiceContainer = ServiceUtils.instance.createMinimalServiceContainerFrom(
                      this.servicesContainer,
                      this._monitoringProperties
                    );
                    await minimalServiceContainer.pluginManager.init();
                    const hostMonitor = new HostMonitor(minimalServiceContainer, this, hostInfo, baselineWriter, someRegionsInaccessible);
                    const promise = hostMonitor.run();
                    this.submittedHosts.set(hostInfo.host, promise);
                  }
                }
              }
            }
          }

          await this.checkForStableReaderTopologies();
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
            // Clear writerHostInfo but keep lastKnownWriterHostInfo so host monitors
            // can use it as a baseline for writer-change detection.
            const clientToClose = this.monitoringClient;
            this.monitoringClient = null;
            await this.closeConnection(clientToClose);
            this.writerHostInfo = null;
            await this.delay(false);
            continue;
          }

          // Refresh lastKnownWriterHostInfo from topology so that if the monitoring
          // connection later breaks, panic-mode host monitors have an accurate baseline.
          const topologyWriter = hosts.find((h) => h.role === HostRole.WRITER);
          if (topologyWriter) {
            this.lastKnownWriterHostInfo = topologyWriter;
          }

          await this.getConnectionHandler().attemptConnectionUpgrade(this.filterHostsForHostMonitoring(hosts));

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
      await this.hostMonitorClientCleanUp();

      this.servicesContainer.eventPublisher.unsubscribe(this, new Set([MonitorResetEvent]));

      logger.debug(Messages.get("ClusterTopologyMonitor.stopHostMonitoringTask", this.initialHostInfo.host));
    }

    return Promise.resolve();
  }

  protected async checkForStableReaderTopologies(): Promise<void> {
    const latestHosts: HostInfo[] = this.getStoredHosts();
    if (!latestHosts || latestHosts.length === 0) {
      this.stableTopologiesStartNs = BigInt(0);
      return;
    }

    const readerIds: string[] = this.filterHostsForHostMonitoring(latestHosts).map((host) => host.hostId);
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

      // Reader topology is stable. Even though no writer was detected by the host monitors (e.g. the writer may
      // live in a region we don't monitor), the readers we did probe have established connections we can use as
      // the monitoring connection. Adopt one so we can exit panic mode. This is only attempted when some regions
      // are inaccessible; otherwise we let the standard writer-detection path run, which also verifies a working
      // writer connection and is more reliable.
      await this.adoptHarvestedMonitoringConnection(readerTopology);
    }
  }

  /**
   * Attempts to exit panic mode by adopting one of the connections harvested from the host monitors as the
   * monitoring connection. Used when the writer resides in an inaccessible region, so no host monitor can obtain
   * a verified writer connection. The connection handler picks the best harvested connection according to its
   * priority; unselected connections are closed. No-op unless we are in panic mode with some regions inaccessible
   * and at least one harvested connection is available.
   *
   * @param readerTopology the reader-observed topology used to inform the handler's selection
   * @returns true if a harvested connection was adopted as the monitoring connection
   */
  protected async adoptHarvestedMonitoringConnection(readerTopology: HostInfo[]): Promise<boolean> {
    if (this.monitoringClient !== null || !this.hostMonitorsSomeRegionsInaccessible) {
      return false;
    }

    this.hostMonitorsStop = true;
    await this.closeHostMonitors();

    if (this.hostMonitorsHarvestedConnections.size === 0) {
      return false;
    }

    const selected: HostInfo | null = this.getConnectionHandler().acceptConnections(
      this.hostMonitorsHarvestedConnections,
      this.writerHostInfo,
      readerTopology
    );

    if (selected) {
      this.lastKnownWriterHostInfo = readerTopology.find((h) => h.role === HostRole.WRITER) ?? this.lastKnownWriterHostInfo;
      this.highRefreshRateEndTimeNs = getTimeInNanos() + BigInt(this.highRefreshRateNs);
      logger.debug(Messages.get("ClusterTopologyMonitor.exitPanicModeViaReaderConsensus", selected.host));
    }

    // Close any harvested connections that were not adopted as the monitoring connection.
    await this.cleanUpHarvestedConnections();

    this.submittedHosts.clear();
    this.stableTopologiesStartNs = BigInt(0);
    this.readerTopologiesById.clear();
    this.completedOneCycle.clear();
    this.hostMonitorsReaderConsensusRequested = false;

    return selected !== null;
  }

  /**
   * Closes every harvested host-monitor connection except the one currently in use as the monitoring
   * connection, then clears the harvest map.
   */
  protected async cleanUpHarvestedConnections(): Promise<void> {
    for (const [, client] of this.hostMonitorsHarvestedConnections) {
      if (client && client !== this.monitoringClient) {
        try {
          await this.closeConnection(client);
        } catch (e: any) {
          // Ignore.
        }
      }
    }
    this.hostMonitorsHarvestedConnections.clear();
  }

  protected async reset(): Promise<void> {
    logger.debug(Messages.get("ClusterTopologyMonitor.reset", this.clusterId, this.initialHostInfo.host));

    this.hostMonitorsStop = true;
    await this.closeHostMonitors();
    await this.hostMonitorClientCleanUp();
    await this.cleanUpHarvestedConnections();
    this.hostMonitorsStop = false;
    this.hostMonitorsSomeRegionsInaccessible = false;
    this.hostMonitorsReaderConsensusRequested = false;
    this.submittedHosts.clear();
    this.stableTopologiesStartNs = BigInt(0);
    this.readerTopologiesById.clear();
    this.completedOneCycle.clear();

    this.hostMonitorsWriterInfo = null;
    this.hostMonitorsLatestTopology = [];

    await this.updateMonitoringClient(null);
    this.writerHostInfo = null;
    this.lastKnownWriterHostInfo = null;
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

  protected async hostMonitorClientCleanUp(): Promise<void> {
    const writerClientToClose = this.hostMonitorsWriterClient;
    const readerClientToClose = this.hostMonitorsReaderClient;

    this.hostMonitorsWriterClient = null;
    this.hostMonitorsReaderClient = null;

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
    await this.hostMonitorClientCleanUp();
  }

  protected filterHostsForHostMonitoring(hosts: HostInfo[]): HostInfo[] {
    return hosts;
  }

  private isInPanicMode(): boolean {
    return !this.monitoringClient;
  }

  private getStoredHosts(): HostInfo[] | null {
    return this.storageService.get(Topology, this.clusterId)?.hosts ?? null;
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
  protected readonly writerHostInfo: HostInfo | null;
  protected readonly someRegionsInaccessible: boolean;
  protected writerChanged: boolean = false;
  protected connectionAttempts: number = 0;
  protected client: ClientWrapper | null = null;

  constructor(
    servicesContainer: FullServicesContainer,
    monitor: ClusterTopologyMonitorImpl,
    hostInfo: HostInfo,
    writerHostInfo: HostInfo | null,
    someRegionsInaccessible: boolean
  ) {
    this.servicesContainer = servicesContainer;
    this.monitor = monitor;
    this.hostInfo = hostInfo;
    this.writerHostInfo = writerHostInfo;
    this.someRegionsInaccessible = someRegionsInaccessible;
  }

  async run() {
    let updateTopology: boolean = false;
    const startTime: number = Date.now();
    logger.debug(Messages.get("HostMonitor.startMonitoring", this.hostInfo.hostId));
    const pluginService = this.servicesContainer.pluginService;
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
              throw new AwsWrapperError(Messages.get("HostMonitor.loginErrorDuringMonitoring"), error);
            } else {
              // It might be some transient error. Let's try again.
              // If the error repeats, we will try again after a longer delay.
              const backoff = this.calculateBackoffWithJitter(this.connectionAttempts++);
              await sleep(backoff);
              this.monitor.completedOneCycle.set(this.hostInfo.hostId, true);
              this.monitor.readerTopologiesById.delete(this.hostInfo.hostId);
              continue;
            }
          }
        }

        if (this.client) {
          let isWriter: boolean = false;
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
              const hostRole = await this.monitor.pluginService.getHostRole(this.client);
              if (hostRole !== HostRole.WRITER) {
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
            if (this.monitor.hostMonitorsWriterClient) {
              // The writer connection is already set up, probably by another host monitor.
              await this.monitor.closeConnection(this.client);
            } else {
              // Successfully updated the host monitor writer connection.
              logger.debug(Messages.get("HostMonitor.detectedWriter", this.hostInfo.hostId, this.hostInfo.url));

              this.servicesContainer.importantEventService.registerEvent(() =>
                Messages.get("HostMonitor.detectedWriter", this.hostInfo.hostId, this.hostInfo.url)
              );

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
              } else if (!this.monitor.hostMonitorsReaderClient) {
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

      if (this.client && !this.monitor.isMonitoringClient(this.client)) {
        // When some regions are inaccessible, the writer may be unreachable and no host monitor can promote a
        // verified writer connection. Hand off this live (reader) connection to the monitor so the main loop can
        // adopt it as the monitoring connection to exit panic mode. Otherwise close it as usual.
        if (this.someRegionsInaccessible && !this.monitor.isStopped && !this.monitor.hostMonitorsWriterClient) {
          this.monitor.harvestConnection(this.hostInfo, this.client);
        } else {
          await this.monitor.closeConnection(this.client);
        }
        // Ownership transferred (or connection closed); don't touch it again.
        this.client = null;
      }
      logger.debug(Messages.get("HostMonitor.endMonitoring", this.hostInfo.hostId, (Date.now() - startTime).toString()));
    }
  }

  private async readerTaskFetchTopology(client: ClientWrapper, writerHostInfo: HostInfo | null) {
    if (!client) {
      return;
    }

    let hosts: HostInfo[] | null;
    try {
      hosts = await this.monitor.queryForTopology(client);
      if (!hosts) {
        return;
      }
    } catch (error) {
      return;
    }

    // Share this topology so that the main monitoring task can adjust the node monitoring tasks.
    this.monitor.hostMonitorsLatestTopology = hosts;
    this.monitor.readerTopologiesById.set(this.hostInfo.hostId, hosts);

    if (this.writerChanged) {
      this.monitor.updateHostsAvailability(hosts);
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, `[hostMonitor ${this.hostInfo.hostId}] `));
      return;
    }

    const latestWriterHostInfo = hosts.find((x) => x.role === HostRole.WRITER);
    if (latestWriterHostInfo && writerHostInfo && latestWriterHostInfo.hostAndPort !== writerHostInfo.hostAndPort) {
      this.writerChanged = true;
      logger.debug(Messages.get("HostMonitor.writerHostChanged", writerHostInfo.hostAndPort, latestWriterHostInfo.hostAndPort));
      this.monitor.updateHostsAvailability(hosts);
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, `[hostMonitor ${this.hostInfo.hostId}] `));

      // With some regions inaccessible, no host monitor may be able to connect to the new writer to verify it,
      // so a reader-observed writer change is the only fast way to exit panic mode. Signal the main loop to adopt
      // a harvested reader connection as the monitoring connection.
      if (this.someRegionsInaccessible) {
        logger.debug(Messages.get("HostMonitor.writerChangeExitTriggered", latestWriterHostInfo.host));
        this.monitor.hostMonitorsReaderConsensusRequested = true;
        this.monitor.hostMonitorsStop = true;
      }
    }
  }

  private calculateBackoffWithJitter(attempt: number): number {
    let backoff = HostMonitor.INITIAL_BACKOFF_MS * Math.round(Math.pow(2, Math.min(attempt, 6)));
    backoff = Math.min(backoff, HostMonitor.MAX_BACKOFF_MS);
    return Math.round(backoff * (0.5 + Math.random() * 0.5));
  }
}
