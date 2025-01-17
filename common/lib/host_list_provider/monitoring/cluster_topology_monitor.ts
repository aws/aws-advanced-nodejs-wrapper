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
import { CacheMap } from "../../utils/cache_map";
import { PluginService } from "../../plugin_service";
import { HostAvailability } from "../../host_availability/host_availability";
import { logTopology, sleep } from "../../utils/utils";
import { logger } from "../../../logutils";
import { HostRole } from "../../host_role";
import { ClientWrapper } from "../../client_wrapper";
import { AwsWrapperError } from "../../utils/errors";
import { MonitoringRdsHostListProvider } from "./monitoring_host_list_provider";
import { Messages } from "../../utils/messages";

export interface ClusterTopologyMonitor {
  forceRefresh(client: any, timeoutMs: number): Promise<HostInfo[]>;

  close(): void;

  forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]>;
}

export class ClusterTopologyMonitorImpl implements ClusterTopologyMonitor {
  private static readonly TOPOLOGY_CACHE_EXPIRATION_NANOS: number = 5 * 60 * 1_000_000_000; // 5 minutes.
  private static readonly MONITORING_PROPERTY_PREFIX: string = "topology-monitoring-";

  private readonly clusterId: string;
  private readonly initialHostInfo: HostInfo;
  private readonly _monitoringProperties: Map<string, any>;
  private readonly _pluginService: PluginService;
  private readonly _hostListProvider: MonitoringRdsHostListProvider;
  private readonly refreshRateMs: number;
  private readonly highRefreshRateMs: number;

  private topologyMap: CacheMap<string, HostInfo[]>;
  private writerHostInfo: HostInfo = null;
  private isVerifiedWriterConnection: boolean = false;
  private monitoringClient: ClientWrapper = null;
  private highRefreshRateEndTime: number = 0;
  private highRefreshPeriodAfterPanicMs: number = 30000; // 30 seconds.
  private ignoreNewTopologyRequestsEndTime: number = -1;
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
    clusterId: string,
    topologyMap: CacheMap<string, HostInfo[]>,
    initialHostSpec: HostInfo,
    props: Map<string, any>,
    pluginService: PluginService,
    hostListProvider: MonitoringRdsHostListProvider,
    refreshRateMs: number,
    highRefreshRateMs: number
  ) {
    this.clusterId = clusterId;
    this.topologyMap = topologyMap;
    this.initialHostInfo = initialHostSpec;
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
    this.untrackedPromises = [];
    this.hostMonitors.clear();
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]> {
    if (this.ignoreNewTopologyRequestsEndTime > 0 && Date.now() < this.ignoreNewTopologyRequestsEndTime) {
      // Previous failover has just completed, use results without triggering new update.
      const currentHosts = this.topologyMap.get(this.clusterId);
      if (currentHosts !== null) {
        return currentHosts;
      }
    }

    if (shouldVerifyWriter) {
      this.isVerifiedWriterConnection = false;
      if (this.monitoringClient) {
        const client = this.monitoringClient;
        this.monitoringClient = null;
        // Abort needed for MySQLClientWrapper in case client already closed.
        await client.abort();
      }
    }

    return await this.waitTillTopologyGetsUpdated(timeoutMs);
  }

  async forceRefresh(client: any, timeoutMs: number): Promise<HostInfo[]> {
    if (this.isVerifiedWriterConnection) {
      return await this.waitTillTopologyGetsUpdated(timeoutMs);
    }

    // Otherwise use provided unverified connection to update topology.
    return await this.fetchTopologyAndUpdateCache(client);
  }

  async waitTillTopologyGetsUpdated(timeoutMs: number): Promise<HostInfo[]> {
    // Signal to any monitor that might be in delay, that topology should be updated.
    this.requestToUpdateTopology = true;

    const currentHosts: HostInfo[] = this.topologyMap.get(this.clusterId);

    if (currentHosts && timeoutMs === 0) {
      return currentHosts;
    }

    const endTime = Date.now() + timeoutMs;
    let latestHosts: HostInfo[];

    while ((latestHosts = this.topologyMap.get(this.clusterId)) === currentHosts && Date.now() < endTime) {
      await sleep(1000);
    }

    if (Date.now() >= endTime) {
      throw new AwsWrapperError(Messages.get("ClusterTopologyMonitor.timeoutError", timeoutMs.toString()));
    }
    return latestHosts;
  }

  async fetchTopologyAndUpdateCache(client: ClientWrapper): Promise<HostInfo[]> {
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

  private async openAnyClientAndUpdateTopology() {
    let writerVerifiedByThisThread = false;
    if (!this.monitoringClient) {
      let client: ClientWrapper;
      try {
        client = await this._pluginService.forceConnect(this.initialHostInfo, this._monitoringProperties);
      } catch {
        logger.error(Messages.get("ClusterTopologyMonitor.unableToConnect", this.initialHostInfo.hostId));
        return null;
      }

      if (client && !this.monitoringClient) {
        this.monitoringClient = client;
        logger.debug(Messages.get("ClusterTopologyMonitor.openedMonitoringConnection", this.initialHostInfo.host));
        try {
          const writerId = await this.getWriterHostId(this.monitoringClient);
          if (writerId) {
            this.isVerifiedWriterConnection = true;
            this.writerHostInfo = this.initialHostInfo;
            writerVerifiedByThisThread = true;
          }
        } catch {
          // Do nothing.
        }
      } else {
        // Monitoring connection already set by another task, close the new connection.
        this.untrackedPromises.push(this.closeConnection(client));
      }
    }

    const hosts: HostInfo[] = await this.fetchTopologyAndUpdateCache(this.monitoringClient);
    if (writerVerifiedByThisThread) {
      if (this.ignoreNewTopologyRequestsEndTime === -1) {
        this.ignoreNewTopologyRequestsEndTime = 0;
      } else {
        this.ignoreNewTopologyRequestsEndTime = Date.now() + this.ignoreTopologyRequestMs;
      }
    }

    if (hosts === null) {
      const clientToClose = this.monitoringClient;
      this.monitoringClient = null;
      this.isVerifiedWriterConnection = false;

      this.untrackedPromises.push(this.closeConnection(clientToClose));
    }
    return hosts;
  }

  updateTopologyCache(hosts: HostInfo[]) {
    this.topologyMap.put(this.clusterId, hosts, ClusterTopologyMonitorImpl.TOPOLOGY_CACHE_EXPIRATION_NANOS);
    this.requestToUpdateTopology = false;
  }

  async getWriterHostId(client: ClientWrapper): Promise<string> {
    return await this.hostListProvider.getWriterId(client);
  }

  async closeConnection(client: ClientWrapper) {
    try {
      await client.end();
    } catch (error) {
      // Ignore.
    }
  }

  private isInPanicMode() {
    return !this.monitoringClient || !this.isVerifiedWriterConnection;
  }

  async run() {
    logger.debug(Messages.get("ClusterTopologyMonitor.startMonitoring"));
    try {
      while (!this.stopMonitoring) {
        if (this.isInPanicMode()) {
          // Panic Mode: high refresh rate in effect.

          if (this.hostMonitors.size === 0) {
            // Initialize host tasks.
            this.hostMonitorsStop = false;
            this.hostMonitorsWriterClient = null;
            this.hostMonitorsReaderClient = null;
            this.hostMonitorsWriterInfo = null;
            this.hostMonitorsLatestTopology = [];

            // Use any client to gather topology information.
            let hosts: HostInfo[] = this.topologyMap.get(this.clusterId);
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
            if (writerClient && writerHostInfo) {
              // Writer detected, update monitoringClient.
              const client = this.monitoringClient;
              this.monitoringClient = writerClient;
              this.untrackedPromises.push(this.closeConnection(client));
              this.isVerifiedWriterConnection = true;
              this.highRefreshRateEndTime = Date.now() + this.highRefreshPeriodAfterPanicMs;
              this.ignoreNewTopologyRequestsEndTime = Date.now() + this.ignoreTopologyRequestMs;

              // Stop monitoring of each host, writer detected.
              this.hostMonitorsStop = true;
              this.hostMonitors.clear();
              continue;
            } else {
              // No writer detected, update host monitors with any new hosts in the topology.
              const hosts = this.hostMonitorsLatestTopology;
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
          if (!hosts) {
            // Unable to gather topology, switch to panic mode.
            const client = this.monitoringClient;
            this.monitoringClient = null;
            this.isVerifiedWriterConnection = false;
            this.untrackedPromises.push(this.closeConnection(client));
            continue;
          }
          if (this.highRefreshRateEndTime > 0 && Date.now() > this.highRefreshRateEndTime) {
            this.highRefreshRateEndTime = 0;
          }
          if (this.highRefreshRateEndTime == 0) {
            // Log topology when not in high refresh rate.
            this.logTopology(`[clusterTopologyMonitor] `);
          }
          // Set an easily interruptible delay between topology refreshes.
          await this.delay(false);
        }
        if (this.ignoreNewTopologyRequestsEndTime > 0 && Date.now() > this.ignoreNewTopologyRequestsEndTime) {
          this.ignoreNewTopologyRequestsEndTime = 0;
        }
      }
    } catch (error) {
      logger.error(Messages.get("ClusterTopologyMonitor.errorDuringMonitoring", error?.message));
    } finally {
      this.stopMonitoring = true;
      const client = this.monitoringClient;
      this.monitoringClient = null;
      await this.closeConnection(client);
      logger.debug(Messages.get("ClusterTopologyMonitor.endMonitoring"));
    }
  }

  private async delay(useHighRefreshRate: boolean) {
    if (this.highRefreshRateEndTime > 0 && Date.now() < this.highRefreshRateEndTime) {
      useHighRefreshRate = true;
    }
    const endTime = Date.now() + (useHighRefreshRate ? this.highRefreshRateMs : this.refreshRateMs);
    await sleep(50);
    while (Date.now() < endTime && !this.requestToUpdateTopology) {
      await sleep(50);
    }
  }

  logTopology(msgPrefix: string) {
    const hosts: HostInfo[] = this.topologyMap.get(this.clusterId);
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
    let client = null;
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
            writerId = await this.monitor.getWriterHostId(client);
          } catch (error) {
            await this.monitor.closeConnection(client);
            client = null;
          }

          if (writerId) {
            if (this.monitor.hostMonitorsWriterClient) {
              await this.monitor.closeConnection(client);
            } else {
              this.monitor.hostMonitorsWriterClient = client;
              this.monitor.hostMonitorsWriterInfo = this.hostInfo;
              logger.debug(Messages.get("HostMonitor.detectedWriter", writerId));
              this.monitor.hostMonitorsStop = true;

              await this.monitor.fetchTopologyAndUpdateCache(client);
              this.monitor.logTopology(`[hostMonitor ${this.hostInfo.hostId}] `);
            }
            client = null;
            return;
          } else if (!client) {
            if (!this.monitor.hostMonitorsWriterClient) {
              if (updateTopology) {
                await this.readerTaskFetchTopology(client, this.writerHostInfo);
              } else if (!this.monitor.hostMonitorsReaderClient) {
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
    if (latestWriterHostInfo && writerHostInfo && latestWriterHostInfo.getHostAndPort() !== writerHostInfo.getHostAndPort()) {
      this.writerChanged = true;

      logger.debug(Messages.get("HostMonitor.writerHostChanged", writerHostInfo.getHostAndPort(), latestWriterHostInfo.getHostAndPort()));
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, `[hostMonitor ${this.hostInfo.hostId}] `));
    }
  }
}
