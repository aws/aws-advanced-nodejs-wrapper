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
import { HostResponseTimeMonitor, ResponseTimeHolder } from "./host_response_time_monitor";
import { FullServicesContainer } from "../../../utils/full_services_container";
import { MonitorErrorResponse } from "../../../utils/monitoring/monitor";

export interface HostResponseTimeService {
  getResponseTime(hostInfo: HostInfo): number;
  setHosts(hosts: HostInfo[]): void;
}

export class HostResponseTimeServiceImpl implements HostResponseTimeService {
  private static readonly MONITOR_DISPOSAL_TIME_NANOS: bigint = BigInt(10 * 60_000_000_000); // 10 minutes
  private static readonly INACTIVE_TIMEOUT_NANOS: bigint = BigInt(3 * 60_000_000_000); // 3 minutes

  private readonly servicesContainer: FullServicesContainer;
  private readonly properties: Map<string, any>;
  private readonly intervalMs: number;
  private hosts: HostInfo[] = [];

  constructor(servicesContainer: FullServicesContainer, properties: Map<string, any>, intervalMs: number) {
    this.servicesContainer = servicesContainer;
    this.properties = properties;
    this.intervalMs = intervalMs;

    this.servicesContainer.storageService.registerItemClassIfAbsent(
      ResponseTimeHolder,
      true,
      HostResponseTimeServiceImpl.MONITOR_DISPOSAL_TIME_NANOS,
      null,
      null
    );

    this.servicesContainer.monitorService.registerMonitorTypeIfAbsent(
      HostResponseTimeMonitor,
      HostResponseTimeServiceImpl.MONITOR_DISPOSAL_TIME_NANOS,
      HostResponseTimeServiceImpl.INACTIVE_TIMEOUT_NANOS,
      new Set([MonitorErrorResponse.RECREATE]),
      ResponseTimeHolder
    );
  }

  getResponseTime(hostInfo: HostInfo): number {
    const holder: ResponseTimeHolder | null = this.servicesContainer.storageService.get(ResponseTimeHolder, hostInfo.url);
    return holder === null ? Number.MAX_SAFE_INTEGER : holder.getResponseTime();
  }

  setHosts(hosts: HostInfo[]): void {
    const oldHostUrls: Set<string> = new Set(this.hosts.map((host) => host.url));
    this.hosts = hosts;

    const servicesContainer = this.servicesContainer;
    const properties = this.properties;
    const intervalMs = this.intervalMs;

    hosts
      .filter((hostInfo) => !oldHostUrls.has(hostInfo.url))
      .forEach((hostInfo) => {
        servicesContainer.monitorService.runIfAbsent(HostResponseTimeMonitor, hostInfo.url, servicesContainer, properties, {
          createMonitor: (sc: FullServicesContainer) => new HostResponseTimeMonitor(sc, hostInfo, properties, intervalMs)
        });
      });
  }
}
