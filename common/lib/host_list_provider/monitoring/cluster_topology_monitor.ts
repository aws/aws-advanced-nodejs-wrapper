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
import { logTopology, sleep } from "../../utils/utils";
import { logger } from "../../../logutils";
import { HostRole } from "../../host_role";
import { ClientWrapper } from "../../client_wrapper";
import { AwsWrapperError } from "../../utils/errors";
import { MonitoringRdsHostListProvider } from "./monitoring_host_list_provider";
import { Messages } from "../../utils/messages";
import { CoreServicesContainer } from "../../utils/core_services_container";
import { Topology } from "../topology";
import { StorageService } from "../../utils/storage/storage_service";
import { TopologyUtils } from "../topology_utils";
import { RdsUtils } from "../../utils/rds_utils";

export interface ClusterTopologyMonitor {
  forceRefresh(client: ClientWrapper, timeoutMs: number): Promise<HostInfo[]>;

  close(): Promise<void>;

  forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]>;
}

export class ClusterTopologyMonitorImpl implements ClusterTopologyMonitor {
  private static readonly TOPOLOGY_CACHE_EXPIRATION_NANOS: number = 5 * 60 * 1_000_000_000; // 5 minutes.
  static readonly MONITORING_PROPERTY_PREFIX: string = "topology_monitoring_";

  private readonly clusterId: string;
  private readonly initialHostInfo: HostInfo;
  private readonly _monitoringProperties: Map<string, any>;
  private readonly _pluginService: PluginService;
  private readonly _hostListProvider: MonitoringRdsHostListProvider;
  private readonly refreshRateMs: number;
  private readonly highRefreshRateMs: number;
  private readonly storageService: StorageService;
  private readonly topologyUtils: TopologyUtils;
  private readonly rdsUtils: RdsUtils = new RdsUtils();
  private readonly instanceTemplate: HostInfo;

  private writerHostInfo: HostInfo = null;
  private isVerifiedWriterConnection: boolean = false;
  private monitoringClient: ClientWrapper = null;
  private highRefreshRateEndTimeMs: number = -1;
  private highRefreshPeriodAfterPanicMs: number = 30000; // 30 seconds.
  private ignoreNewTopologyRequestsEndTimeMs: number = -1;
  private ignoreTopologyRequestMs: number = 10000; // 10 seconds.

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

  constructor(
    topologyUtils: TopologyUtils,
    clusterId: string,
    initialHostInfo: HostInfo,
    props: Map<string, any>,
    instanceTemplate: HostInfo,
    pluginService: PluginService,
    hostListProvider: MonitoringRdsHostListProvider,
    refreshRateMs: number,
    highRefreshRateMs: number
  ) {
    this.topologyUtils = topologyUtils;
    this.clusterId = clusterId;
    this.storageService = CoreServicesContainer.getInstance().getStorageService(); // TODO: store serviceContainer instead
    this.initialHostInfo = initialHostInfo;
    this.instanceTemplate = instanceTemplate;
    this._pluginService = pluginService;
    this._hostListProvider = hostListProvider;
    this.refreshRateMs = refreshRateMs;
    this.highRefreshRateMs = highRefreshRateMs;

    this._monitoringProperties = new Map<string, any>(props);
    for (const [key, val] of props) {
      if (key.startsWith(ClusterTopologyMonitorImpl.MONITORING_PROPERTY_PREFIX)) {
        this._monitoringProperties.set(key.substring(ClusterTopologyMonitorImpl.MONITORING_PROPERTY_PREFIX.length), val);
        this._monitoringProperties.delete(key);
      }
    }
    this.untrackedPromises.push(this.run());
  }

  get hostListProvider(): MonitoringRdsHostListProvider {
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
    await Promise.all(this.untrackedPromises);
    await this.closeConnection(this.monitoringClient);
    await this.closeConnection(this.hostMonitorsWriterClient);
    await this.closeConnection(this.hostMonitorsReaderClient);
    this.untrackedPromises = [];
    this.hostMonitors.clear();
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[] | null> {
    if (Date.now() < this.ignoreNewTopologyRequestsEndTimeMs) {
      // Previous failover has just completed, use results without triggering new update.
      const currentHosts = this.getStoredHosts();
      if (currentHosts !== null) {
        logger.info(Messages.get("ClusterTopologyMonitoring.ignoringNewTopologyRequest"));
        return currentHosts;
      }
    }

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
      return await this.waitTillTopologyGetsUpdated(timeoutMs);
    }

    // Otherwise use provided unverified connection to update topology.
    return await this.fetchTopologyAndUpdateCache(client);
  }

  async waitTillTopologyGetsUpdated(timeoutMs: number): Promise<HostInfo[] | null> {
    // Signal to any monitor that might be in delay, that topology should be updated.
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
      throw new AwsWrapperError(Messages.get("ClusterTopologyMonitor.timeoutError", timeoutMs.toString()));
    }
    return latestHosts;
  }

  async fetchTopologyAndUpdateCache(client: ClientWrapper): Promise<HostInfo[] | null> {
    if (!client) {
      return null;
    }

    try {
      const hosts: HostInfo[] = await this._hostListProvider.sqlQueryForTopology(client);
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
    let writerVerifiedByThisTask = false;
    if (!this.monitoringClient) {
      let client: ClientWrapper;
      try {
        client = await this._pluginService.forceConnect(this.initialHostInfo, this._monitoringProperties);
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
              writerVerifiedByThisTask = true;
            } else {
              const pair: [string, string] = await this.topologyUtils.getInstanceId(this.monitoringClient);
              const instanceTemplate: HostInfo = await this.getInstanceTemplate(pair[1], this.monitoringClient);
              this.writerHostInfo = this.topologyUtils.createHost(pair[0], pair[1], true, 0, null, this.initialHostInfo, instanceTemplate);
              logger.debug(Messages.get("ClusterTopologyMonitor.writerMonitoringConnection", this.writerHostInfo.host));
            }
          }
        } catch (error) {
          // Do nothing.
          logger.error(Messages.get("ClusterTopologyMonitor.invalidWriterQuery", error?.message));
        }
      } else {
        // Monitoring connection already set by another task, close the new connection.
        await this.closeConnection(client);
      }
    }

    const hosts: HostInfo[] = await this.fetchTopologyAndUpdateCache(this.monitoringClient);
    if (writerVerifiedByThisTask) {
      if (this.ignoreNewTopologyRequestsEndTimeMs === -1) {
        this.ignoreNewTopologyRequestsEndTimeMs = 0;
      } else {
        this.ignoreNewTopologyRequestsEndTimeMs = Date.now() + this.ignoreTopologyRequestMs;
      }
    }

    if (hosts === null) {
      this.isVerifiedWriterConnection = false;
      await this.updateMonitoringClient(null);
    }
    return hosts;
  }

  protected getInstanceTemplate(hostId: string, targetClient: ClientWrapper): Promise<HostInfo> {
    return Promise.resolve(this.instanceTemplate);
  }

  updateTopologyCache(hosts: HostInfo[]): void {
    this.storageService.set(this.clusterId, new Topology(hosts));
    this.requestToUpdateTopology = false;
  }

  async getWriterHostIdIfConnected(client: ClientWrapper, hostId: string): Promise<string> {
    const writerHost: string = await this.hostListProvider.getWriterId(client);
    // Returns the hostId of the writer if client is connected to that writer, otherwise returns null.
    return writerHost === hostId ? writerHost : null;
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

  private isInPanicMode(): boolean {
    return !this.monitoringClient || !this.isVerifiedWriterConnection;
  }

  async run(): Promise<void> {
    logger.debug(Messages.get("ClusterTopologyMonitor.startMonitoring"));
    try {
      while (!this.stopMonitoring) {
        if (this.isInPanicMode()) {
          // Panic Mode: high refresh rate in effect.

          if (this.hostMonitors.size === 0) {
            // Initialize host tasks.
            logger.debug(Messages.get("ClusterTopologyMonitor.startingHostMonitors"));
            this.hostMonitorsStop = false;
            if (this.hostMonitorsReaderClient !== null) {
              await this.closeConnection(this.hostMonitorsReaderClient);
            }
            if (this.hostMonitorsWriterClient !== null) {
              await this.closeConnection(this.hostMonitorsWriterClient);
            }
            this.hostMonitorsWriterClient = null;
            this.hostMonitorsReaderClient = null;
            this.hostMonitorsWriterInfo = null;
            this.hostMonitorsLatestTopology = [];

            // Use any client to gather topology information.
            let hosts: HostInfo[] = this.getStoredHosts();
            if (!hosts) {
              hosts = await this.openAnyClientAndUpdateTopology();
            }

            // Set up host monitors.
            if (hosts && !this.isVerifiedWriterConnection) {
              for (const hostInfo of hosts) {
                if (!this.hostMonitors.has(hostInfo.host)) {
                  const hostMonitor = new HostMonitor(this, hostInfo, this.writerHostInfo);
                  const hostRun = hostMonitor.run();
                  this.hostMonitors.set(hostInfo.host, hostMonitor);
                  this.untrackedPromises.push(hostRun);
                }
              }
            }
            // If topology is not correctly updated, will try on the next round.
          } else {
            // Host monitors already running, check if a writer has been detected.
            const writerClient = this.hostMonitorsWriterClient;
            const writerHostInfo = this.hostMonitorsWriterInfo;
            if (writerClient && writerHostInfo && writerHostInfo !== this.writerHostInfo) {
              // Writer detected, update monitoringClient.
              logger.info(Messages.get("ClusterTopologyMonitor.writerPickedUpFromHostMonitors", writerHostInfo.hostId));
              await this.updateMonitoringClient(writerClient);
              this.writerHostInfo = writerHostInfo;
              this.isVerifiedWriterConnection = true;
              if (this.ignoreNewTopologyRequestsEndTimeMs === -1) {
                this.ignoreNewTopologyRequestsEndTimeMs = 0;
              } else {
                this.ignoreNewTopologyRequestsEndTimeMs = Date.now() + this.ignoreTopologyRequestMs;
              }
              if (this.highRefreshRateEndTimeMs === -1) {
                this.highRefreshRateEndTimeMs = 0;
              } else {
                this.highRefreshRateEndTimeMs = Date.now() + this.highRefreshPeriodAfterPanicMs;
              }

              // Stop monitoring of each host, writer detected.
              this.hostMonitorsStop = true;
              this.hostMonitors.clear();
              continue;
            } else {
              // No writer detected, update host monitors with any new hosts in the topology.
              const hosts: HostInfo[] = this.hostMonitorsLatestTopology;
              if (hosts !== null && !this.hostMonitorsStop) {
                for (const hostInfo of hosts) {
                  if (!this.hostMonitors.has(hostInfo.host)) {
                    const hostMonitor = new HostMonitor(this, hostInfo, this.writerHostInfo);
                    const hostRun = hostMonitor.run();
                    this.hostMonitors.set(hostInfo.host, hostMonitor);
                    this.untrackedPromises.push(hostRun);
                  }
                }
              }
            }
          }
          // Trigger a delay before retrying.
          await this.delay(true);
        } else {
          // Regular mode: lower refresh rate than panic mode.
          if (this.hostMonitors.size !== 0) {
            // Stop host monitors.
            this.hostMonitorsStop = true;
            this.hostMonitors.clear();
          }
          const hosts = await this.fetchTopologyAndUpdateCache(this.monitoringClient);
          if (hosts === null) {
            // Unable to gather topology, switch to panic mode.
            this.isVerifiedWriterConnection = false;
            await this.updateMonitoringClient(null);
            continue;
          }
          if (this.highRefreshRateEndTimeMs > 0 && Date.now() > this.highRefreshRateEndTimeMs) {
            this.highRefreshRateEndTimeMs = 0;
          }
          if (this.highRefreshRateEndTimeMs < 0) {
            // Log topology when not in high refresh rate.
            this.logTopology(`[clusterTopologyMonitor] `);
          }
          // Set an easily interruptible delay between topology refreshes.
          await this.delay(false);
        }
        if (this.ignoreNewTopologyRequestsEndTimeMs > 0 && Date.now() > this.ignoreNewTopologyRequestsEndTimeMs) {
          this.ignoreNewTopologyRequestsEndTimeMs = 0;
        }
      }
    } catch (error) {
      logger.error(Messages.get("ClusterTopologyMonitor.errorDuringMonitoring", error?.message));
    } finally {
      this.stopMonitoring = true;
      await this.updateMonitoringClient(null);
      logger.debug(Messages.get("ClusterTopologyMonitor.endMonitoring"));
    }
  }

  private getStoredHosts(): HostInfo[] | null {
    const topology = this.storageService.get(Topology, this.clusterId);
    return topology == null ? null : topology.hosts;
  }

  private async delay(useHighRefreshRate: boolean) {
    if (Date.now() < this.highRefreshRateEndTimeMs) {
      useHighRefreshRate = true;
    }
    const endTime = Date.now() + (useHighRefreshRate ? this.highRefreshRateMs : this.refreshRateMs);
    await sleep(50);
    while (Date.now() < endTime && !this.requestToUpdateTopology) {
      await sleep(50);
    }
  }

  logTopology(msgPrefix: string) {
    const hosts: HostInfo[] = this.getStoredHosts();
    if (hosts && hosts.length !== 0) {
      logger.debug(logTopology(hosts, msgPrefix));
    }
  }
}

export class HostMonitor {
  protected readonly monitor: ClusterTopologyMonitorImpl;
  protected readonly hostInfo: HostInfo;
  protected readonly writerHostInfo: HostInfo;
  protected writerChanged: boolean = false;

  constructor(monitor: ClusterTopologyMonitorImpl, hostInfo: HostInfo, writerHostInfo: HostInfo) {
    this.monitor = monitor;
    this.hostInfo = hostInfo;
    this.writerHostInfo = writerHostInfo;
  }

  async run() {
    let client: ClientWrapper | null = null;
    let updateTopology: boolean = false;
    const startTime: number = Date.now();
    logger.debug(Messages.get("HostMonitor.startMonitoring", this.hostInfo.hostId));
    try {
      while (!this.monitor.hostMonitorsStop) {
        if (!client) {
          try {
            client = await this.monitor.pluginService.forceConnect(this.hostInfo, this.monitor.monitoringProperties);
            this.monitor.pluginService.setAvailability(this.hostInfo.allAliases, HostAvailability.AVAILABLE);
          } catch (error) {
            this.monitor.pluginService.setAvailability(this.hostInfo.allAliases, HostAvailability.NOT_AVAILABLE);
          }
        }

        if (client) {
          let writerId = null;
          try {
            writerId = await this.monitor.getWriterHostIdIfConnected(client, this.hostInfo.hostId);
          } catch (error) {
            logger.error(Messages.get("ClusterTopologyMonitor.invalidWriterQuery", error?.message));
            await this.monitor.closeConnection(client);
            client = null;
          }

          if (writerId) {
            // First connection after failover may be stale.
            if ((await this.monitor.pluginService.getHostRole(client)) !== HostRole.WRITER) {
              logger.debug(Messages.get("HostMonitor.writerIsStale", writerId));
              writerId = null;
            }
          }

          if (writerId) {
            if (this.monitor.hostMonitorsWriterClient) {
              await this.monitor.closeConnection(client);
            } else {
              logger.debug(Messages.get("HostMonitor.detectedWriter", writerId, this.hostInfo.host));
              const updatedHosts: HostInfo[] = await this.monitor.fetchTopologyAndUpdateCache(client);
              if (updatedHosts && this.monitor.hostMonitorsWriterClient === null) {
                this.monitor.hostMonitorsWriterClient = client;
                this.monitor.hostMonitorsWriterInfo = this.hostInfo;
                this.monitor.hostMonitorsStop = true;
                this.monitor.logTopology(`[hostMonitor ${this.hostInfo.hostId}] `);
              } else {
                await this.monitor.closeConnection(client);
              }
            }
            client = null;
            return;
          } else if (client) {
            // Client is a reader.
            if (!this.monitor.hostMonitorsWriterClient) {
              // While the writer hasn't been identified, reader client can update topology.
              if (updateTopology) {
                await this.readerTaskFetchTopology(client, this.writerHostInfo);
              } else if (this.monitor.hostMonitorsReaderClient === null) {
                this.monitor.hostMonitorsReaderClient = client;
                updateTopology = true;
                await this.readerTaskFetchTopology(client, this.writerHostInfo);
              }
            }
          }
        }
        await sleep(100);
      }
    } catch (error) {
      // Close the monitor.
    } finally {
      await this.monitor.closeConnection(client);
      logger.debug(Messages.get("HostMonitor.endMonitoring", this.hostInfo.hostId, (Date.now() - startTime).toString()));
    }
  }

  private async readerTaskFetchTopology(client: any, writerHostInfo: HostInfo) {
    if (!client) {
      return;
    }

    let hosts: HostInfo[];
    try {
      hosts = await this.monitor.hostListProvider.sqlQueryForTopology(client);
      if (hosts === null) {
        return;
      }
      this.monitor.hostMonitorsLatestTopology = hosts;
    } catch (error) {
      return;
    }

    if (this.writerChanged) {
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, `[hostMonitor ${this.hostInfo.hostId}] `));
      return;
    }

    const latestWriterHostInfo: HostInfo = hosts.find((x) => x.role === HostRole.WRITER);
    if (latestWriterHostInfo && writerHostInfo && latestWriterHostInfo.hostAndPort !== writerHostInfo.hostAndPort) {
      this.writerChanged = true;
      logger.debug(Messages.get("HostMonitor.writerHostChanged", writerHostInfo.hostAndPort, latestWriterHostInfo.hostAndPort));
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, `[hostMonitor ${this.hostInfo.hostId}] `));
    }
  }
}
