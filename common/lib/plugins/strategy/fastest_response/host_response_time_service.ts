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

import { HostInfo } from "../../../host_info";
import { PluginService } from "../../../plugin_service";
import { TelemetryFactory } from "../../../utils/telemetry/telemetry_factory";
import { SlidingExpirationCache } from "../../../utils/sliding_expiration_cache";
import { HostResponseTimeMonitor } from "./host_response_time_monitor";

export interface HostResponseTimeService {
  /**
   * Return a response time in milliseconds to the host.
   * Return Number.MAX_SAFE_INTEGER if response time is not available.
   *
   * @param hostInfo the host details
   * @return response time in milliseconds for a desired host.
   */
  getResponseTime(hostInfo: HostInfo): number;

  /**
   * Provides an updated host list to a service.
   */
  setHosts(hosts: HostInfo[]): void;
}

export class HostResponseTimeServiceImpl implements HostResponseTimeService {
  static readonly CACHE_EXPIRATION_NANOS: bigint = BigInt(10 * 60_000_000_000); // 10 minutes
  static readonly CACHE_CLEANUP_NANOS: bigint = BigInt(60_000_000_000); // 1 minute

  private readonly pluginService: PluginService;
  readonly properties: Map<string, string>;
  readonly intervalMs: number;
  protected hosts: HostInfo[];
  private readonly telemetryFactory: TelemetryFactory;
  protected static monitoringHosts: SlidingExpirationCache<string, any> = new SlidingExpirationCache(
    HostResponseTimeServiceImpl.CACHE_CLEANUP_NANOS,
    (monitor: any) => true,
    async (monitor: HostResponseTimeMonitor) => {
      {
        try {
          await monitor.close();
        } catch (error) {
          // ignore
        }
      }
    }
  );

  constructor(pluginService: PluginService, properties: Map<string, any>, intervalMs: number) {
    this.pluginService = pluginService;
    this.properties = properties;
    this.intervalMs = intervalMs;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();
    HostResponseTimeServiceImpl.monitoringHosts.cleanupIntervalNs = BigInt(intervalMs) ?? HostResponseTimeServiceImpl.CACHE_CLEANUP_NANOS;
    this.telemetryFactory.createGauge("frt.hosts.count", () => HostResponseTimeServiceImpl.monitoringHosts.size);
  }

  getResponseTime(hostInfo: HostInfo): number {
    const monitor: HostResponseTimeMonitor = HostResponseTimeServiceImpl.monitoringHosts.get(
      hostInfo.url,
      HostResponseTimeServiceImpl.CACHE_EXPIRATION_NANOS
    );
    if (!monitor) {
      return Number.MAX_SAFE_INTEGER;
    }
    return monitor.getResponseTime();
  }

  setHosts(hosts: HostInfo[]): void {
    const oldHostMap: Map<string, HostInfo> = new Map(hosts.map((e) => [e.url, e]));
    this.hosts = hosts;
    const eligibleHosts: HostInfo[] = hosts.filter((hostInfo: HostInfo) => !(hostInfo.url in oldHostMap));
    eligibleHosts.forEach((hostInfo: HostInfo) => {
      HostResponseTimeServiceImpl.monitoringHosts.computeIfAbsent(
        hostInfo.url,
        (key) => new HostResponseTimeMonitor(this.pluginService, hostInfo, this.properties, this.intervalMs),
        HostResponseTimeServiceImpl.CACHE_EXPIRATION_NANOS
      );
    });
  }
}
