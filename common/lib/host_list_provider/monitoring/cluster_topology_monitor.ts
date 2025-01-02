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
import { HostListProviderService } from "../../host_list_provider_service";
import { HostAvailability } from "../../host_availability/host_availability";
import { logTopology, sleep } from "../../utils/utils";
import { logger } from "../../../logutils";
import { HostRole } from "../../host_role";
import { ClientWrapper } from "../../client_wrapper";
import { Messages } from "../../utils/messages";
import { TopologyAwareDatabaseDialect } from "../../topology_aware_database_dialect";
import { HostListProvider } from "../host_list_provider";
import { AwsWrapperError } from "../../utils/errors";

export interface ClusterToplogyMonitor {
  forceRefresh(client: any, timeoutMs: number): Promise<HostInfo[]>;

  setClusterId(clusterId: string): void;

  close(): void;

  forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]>;
}

export class ClusterToplogyMonitorImpl implements ClusterToplogyMonitor {
  public clusterId: string;
  public topologyMap: CacheMap<string, HostInfo[]>;
  private topologyCacheExpirationNanos: number = 10000; // TODO: investigate values and set in constructor.
  protected initialHostInfo: HostInfo;
  public properties: Map<string, any>;
  public pluginService: PluginService;
  protected hostListProviderService: HostListProviderService;
  private hostListProvider: HostListProvider;
  protected refreshRate: number = 300; // TODO: investigate issues with setting lower values.
  private highRefreshRate: number = 300;

  private writerHostInfo: HostInfo = null;
  private isVerifiedWriterConnection: boolean = false;
  private monitoringClient: ClientWrapper = null;
  private highRefreshRateEndTime: any = 0;
  private highRefreshPeriodAfterPanic: number = 30000; // 30 seconds.
  private ignoreTopologyRequest: number = 1000; // 10 seconds.
  private ignoreNewTopologyRequestsEndTime: number = 0;

  // Controls for stopping the ClusterTopologyMonitor run.
  private stopMonitoring: boolean = false;
  private runPromise: Promise<void>;

  // Tracking of the host monitors.
  private hostMonitors: Map<string, HostMonitor> = new Map();
  public hostMonitorsWriterClient = null;
  public hostMonitorsWriterInfo: HostInfo = null;
  public hostMonitorsReaderClient = null;
  public hostMonitorsLatestTopology: HostInfo[] = null;
  // Controls for stopping all the host monitors run.
  public hostMonitorsStop: boolean = false;
  private untrackedPromises: Promise<void>[] = [];

  // Signals to other methods that asynchronous operations have completed/should be completed.
  private requestToUpdateTopology: boolean = false;
  private releaseTopologyUpdate: () => void;
  private topologyUpdated = new Promise<void>((done) => {
    this.releaseTopologyUpdate = () => {
      done();
    };
  });

  constructor(
    clusterId: string,
    topologyMap: CacheMap<string, HostInfo[]>,
    initialHostSpec: HostInfo,
    props,
    pluginService: PluginService,
    hostListProviderService: HostListProviderService,
    hostListProvider: HostListProvider,
    refreshRateNano
  ) {
    this.clusterId = clusterId;
    this.topologyMap = topologyMap;
    this.initialHostInfo = initialHostSpec;
    this.pluginService = pluginService;
    this.hostListProviderService = hostListProviderService;
    this.hostListProvider = hostListProvider;
    this.properties = props;
    //this.refreshRateNano = refreshRateNano; // TODO: coordinate timeouts for bigint or number.
    const runMonitor = this.run();
    this.runPromise = runMonitor;
  }

  async close(): Promise<void> {
    this.stopMonitoring = true;
    this.hostMonitorsStop = true;
    await Promise.all(this.runPromise ? this.untrackedPromises.concat(this.runPromise) : this.untrackedPromises);
    this.untrackedPromises = [];
    this.hostMonitors.clear();
  }

  setClusterId(clusterId: string): void {
    this.clusterId = clusterId;
  }

  async forceMonitoringRefresh(shouldVerifyWriter: boolean, timeoutMs: number): Promise<HostInfo[]> {
    const currentHosts = this.topologyMap.get(this.clusterId);
    if (currentHosts) {
      return currentHosts;
    }
    if (shouldVerifyWriter) {
      const client = this.monitoringClient;
      this.monitoringClient = null;
      this.isVerifiedWriterConnection = false;
      await this.closeConnection(client);
    }

    return this.waitTillTopologyGetsUpdated(timeoutMs);
  }

  async forceRefresh(client: any, timeoutMs: number): Promise<HostInfo[]> {
    if (this.isVerifiedWriterConnection) {
      return await this.waitTillTopologyGetsUpdated(timeoutMs);
    }

    // Otherwise use provided unverified connection to update topology
    return await this.fetchTopologyAndUpdateCache(client);
  }

  async waitTillTopologyGetsUpdated(timeoutMs: number): Promise<HostInfo[]> {
    const currentHosts: HostInfo[] = this.topologyMap.get(this.clusterId);
    let latestHosts: HostInfo[];

    // Notify monitor (that might be in delay) that topology should be updated.
    this.requestToUpdateTopology = true;

    if (timeoutMs === 0) {
      return currentHosts;
    }

    let timeoutId: any;
    const timeoutTask: Promise<void> = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject("Topology update timed out.");
      }, timeoutMs);
    });

    return await Promise.race([timeoutTask, await this.topologyUpdated])
      .then((result) => {
        latestHosts = this.topologyMap.get(this.clusterId);
        return latestHosts === currentHosts ? null : latestHosts;
      })
      .catch((error: any) => {
        logger.debug(`Could not update topology: ${error}.`);
        if (JSON.stringify(error).includes("Topology update timed out.")) {
          throw new AwsWrapperError(`ClusterTopologyMonitor topology update timed out in ${timeoutMs} ms.`);
        }
        return null;
      })
      .finally(async () => {
        clearTimeout(timeoutId);
      });
  }

  async fetchTopologyAndUpdateCache(client: any): Promise<HostInfo[]> {
    if (!client) {
      return null;
    }

    try {
      const hosts: HostInfo[] = await this.queryForTopology(client);
      if (hosts) {
        this.updateTopologyCache(hosts);
      }
      return hosts;
    } catch (error) {
      logger.error(`Error fetching topology: ${error}.`);
    }
    return null;
  }

  private openAnyClientAndUpdateTopology() {
    // TODO: implement method.
    return [];
  }

  async queryForTopology(targetClient: ClientWrapper): Promise<HostInfo[]> {
    const dialect = this.hostListProviderService.getDialect();
    if (!this.isTopologyAwareDatabaseDialect(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }
    return await dialect.queryForTopology(targetClient, this.hostListProvider).then((res: any) => this.processQueryResults(res));
  }

  protected isTopologyAwareDatabaseDialect(arg: any): arg is TopologyAwareDatabaseDialect {
    return arg;
  }

  private async processQueryResults(result: HostInfo[]): Promise<HostInfo[]> {
    const hostMap: Map<string, HostInfo> = new Map<string, HostInfo>();

    let hosts: HostInfo[] = [];
    const writers: HostInfo[] = [];
    result.forEach((host) => {
      hostMap.set(host.host, host);
    });

    hostMap.forEach((host) => {
      if (host.role !== HostRole.WRITER) {
        hosts.push(host);
      } else {
        writers.push(host);
      }
    });

    const writerCount: number = writers.length;
    if (writerCount === 0) {
      hosts = [];
    } else if (writerCount === 1) {
      hosts.push(writers[0]);
    } else {
      const sortedWriters: HostInfo[] = writers.sort((a, b) => {
        return b.lastUpdateTime - a.lastUpdateTime;
      });

      hosts.push(sortedWriters[0]);
    }

    return hosts;
  }

  updateTopologyCache(hosts: HostInfo[]) {
    this.topologyMap.put(this.clusterId, hosts, this.topologyCacheExpirationNanos);
    this.releaseTopologyUpdate();
    this.topologyUpdated = new Promise<void>((done) => {
      this.releaseTopologyUpdate = () => {
        done();
      };
    });
  }

  getWriterHostId(client: ClientWrapper) {
    return client.hostInfo.role === HostRole.WRITER ? client.id : null;
  }

  async closeConnection(client: any) {
    if (!client) {
      return;
    }
    await this.pluginService.abortTargetClient(client);
  }

  private isInPanicMode() {
    return !this.monitoringClient || !this.isVerifiedWriterConnection;
  }

  async run() {
    logger.debug(`Start cluster monitoring thread: ${this.initialHostInfo.host}`);
    try {
      while (!this.stopMonitoring) {
        if (this.isInPanicMode()) {
          // Panic Mode: high refresh rate in effect.

          if (this.hostMonitors.size === 0) {
            // Initialize host threads.
            this.hostMonitorsStop = false;
            this.hostMonitorsWriterClient = null;
            this.hostMonitorsReaderClient = null;
            this.hostMonitorsWriterInfo = null;
            this.hostMonitorsLatestTopology = null;

            // Use any client to gather topology information.
            let hosts: HostInfo[] = this.topologyMap.get(this.clusterId);
            if (!hosts) {
              hosts = this.openAnyClientAndUpdateTopology();
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
              await this.closeConnection(client);
              this.isVerifiedWriterConnection = true;
              this.highRefreshRateEndTime = Date.now() + this.highRefreshPeriodAfterPanic;
              this.ignoreNewTopologyRequestsEndTime = Date.now() - this.ignoreTopologyRequest;

              // Stop monitoring of each host, writer detected.
              this.hostMonitorsStop = true;
              await Promise.all(this.untrackedPromises);
              this.untrackedPromises = [];
              this.hostMonitors.clear();
              continue;
            } else {
              // No writer detected, update host monitors with any new hosts in the topology.
              const hosts = this.hostMonitorsLatestTopology;
              if (hosts && !this.hostMonitorsStop) {
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
            await Promise.all(this.untrackedPromises);
            this.untrackedPromises = [];
            this.hostMonitors.clear();
          }
          const hosts = this.fetchTopologyAndUpdateCache(this.monitoringClient);
          if (!hosts) {
            // Unable to gather topology, switch to panic mode.
            const client = this.monitoringClient;
            this.monitoringClient = null;
            this.isVerifiedWriterConnection = false;
            await this.closeConnection(client);
            continue;
          }
          if (this.highRefreshRateEndTime > 0 && Date.now() > this.highRefreshRateEndTime) {
            this.highRefreshRateEndTime = 0;
          }
          if (this.highRefreshRateEndTime == 0) {
            // Log topology when not in high refresh rate.
            logger.debug(logTopology(this.topologyMap.get(this.clusterId), ""));
          }
          // Set an easily interruptible delay between topology refreshes.
          await this.delay(false);
        }
        if (this.ignoreNewTopologyRequestsEndTime > 0 && Date.now() > this.ignoreNewTopologyRequestsEndTime) {
          this.ignoreNewTopologyRequestsEndTime = 0;
        }
      }
    } catch (error) {
      logger.error(`Exception during monitoring: ${error}.`);
    } finally {
      this.stopMonitoring = true;
      const client = this.monitoringClient;
      this.monitoringClient = null;
      await this.closeConnection(client);
      logger.debug(`Stop monitoring ClusterTopologyMonitor: ${this.initialHostInfo.getHostAndPort()}.`);
    }
  }

  private async delay(useHighRefreshRate: boolean) {
    const endTime = Date.now() + (useHighRefreshRate ? this.highRefreshRate : this.refreshRate);
    while (Date.now() < endTime && !this.requestToUpdateTopology) {
      await sleep(50);
    }
    this.requestToUpdateTopology = false;
  }
}

export class HostMonitor {
  protected readonly monitor: ClusterToplogyMonitorImpl;
  protected readonly hostInfo: HostInfo;
  protected readonly writerHostInfo: HostInfo;
  protected writerChanged: boolean = false;

  constructor(monitor: ClusterToplogyMonitorImpl, hostInfo: HostInfo, writerHostInfo: HostInfo) {
    this.monitor = monitor;
    this.hostInfo = hostInfo;
    this.writerHostInfo = writerHostInfo;
  }

  async run() {
    let client = null;
    let updateTopology: boolean = false;
    const startTime: number = Date.now();
    try {
      while (!this.monitor.hostMonitorsStop) {
        if (!client) {
          try {
            client = await this.monitor.pluginService.forceConnect(this.hostInfo, this.monitor.properties);
            this.monitor.pluginService.setAvailability(this.hostInfo.allAliases, HostAvailability.AVAILABLE);
          } catch (error) {
            this.monitor.pluginService.setAvailability(this.hostInfo.allAliases, HostAvailability.NOT_AVAILABLE);
          }
        }

        if (client) {
          let writerId = null;
          try {
            writerId = this.monitor.getWriterHostId(client);
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
              logger.debug(`Detected writer: ${writerId}`);
              this.monitor.hostMonitorsStop = true;

              await this.monitor.fetchTopologyAndUpdateCache(client);
              logger.debug(logTopology(this.monitor.topologyMap.get(this.monitor.clusterId), ""));
            }

            client = null;
            return;
          } else if (!client) {
            if (!this.monitor.hostMonitorsWriterClient) {
              if (updateTopology) {
                await this.readerThreadFetchTopology(client, this.writerHostInfo);
              } else if (!this.monitor.hostMonitorsReaderClient) {
                this.monitor.hostMonitorsReaderClient = client;
                updateTopology = true;
                await this.readerThreadFetchTopology(client, this.writerHostInfo);
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
      logger.debug(`Host monitor completed in ${Date.now() - startTime}.`);
    }
  }

  private async readerThreadFetchTopology(client: any, writerHostInfo: HostInfo) {
    if (!client) {
      return;
    }

    let hosts: HostInfo[];
    try {
      hosts = await this.monitor.queryForTopology(client);
    } catch (error) {
      return;
    }

    this.monitor.hostMonitorsLatestTopology = hosts;

    if (this.writerChanged) {
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, ""));
      return;
    }

    const latestWriterHostInfo: HostInfo = hosts.find((x) => x.role === HostRole.WRITER);
    if (latestWriterHostInfo && writerHostInfo && latestWriterHostInfo.getHostAndPort() !== writerHostInfo.getHostAndPort()) {
      this.writerChanged = true;

      logger.debug(`Writer host has changed from ${writerHostInfo.getHostAndPort()} to ${latestWriterHostInfo.getHostAndPort()}.`);
      this.monitor.updateTopologyCache(hosts);
      logger.debug(logTopology(hosts, ""));
    }
  }
}
