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
import { HostRole } from "../../host_role";
import { PluginService } from "../../plugin_service";
import { WrapperProperties } from "../../wrapper_property";
import { RdsUtils } from "../../utils/rds_utils";
import { ClientWrapper } from "../../client_wrapper";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { AbstractMonitoringConnectionHandler } from "./monitoring_connection_handler";
import { equalsIgnoreCase } from "../../utils/utils";

export enum GlobalDbMonitoringConnectionPriority {
  STRICT_WRITER_PRIMARY = "strict-writer-primary",
  STRICT_WRITER_SECONDARY = "strict-writer-secondary",
  STRICT_READER_PRIMARY = "strict-reader-primary",
  STRICT_READER_SECONDARY = "strict-reader-secondary",
  WRITER_OR_READER_PRIMARY = "writer-or-reader-primary",
  WRITER_OR_READER_SECONDARY = "writer-or-reader-secondary",
  REGION = "region"
}

interface GlobalDbPriorityConfig {
  type: GlobalDbMonitoringConnectionPriority;
  region?: string;
}

// AWS region identifiers look like "us-east-1", "eu-west-2", "ap-southeast-1".
const REGION_SHAPE = /^[a-z]{2}-[a-z]+-\d+$/;

function parseGlobalDbPriority(value: string | null): GlobalDbPriorityConfig | null {
  if (!value) {
    return null;
  }
  const lower = value.toLowerCase().trim();
  switch (lower) {
    case "strict-writer-primary":
      return { type: GlobalDbMonitoringConnectionPriority.STRICT_WRITER_PRIMARY };
    case "strict-writer-secondary":
      return { type: GlobalDbMonitoringConnectionPriority.STRICT_WRITER_SECONDARY };
    case "strict-reader-primary":
      return { type: GlobalDbMonitoringConnectionPriority.STRICT_READER_PRIMARY };
    case "strict-reader-secondary":
      return { type: GlobalDbMonitoringConnectionPriority.STRICT_READER_SECONDARY };
    case "writer-or-reader-primary":
      return { type: GlobalDbMonitoringConnectionPriority.WRITER_OR_READER_PRIMARY };
    case "writer-or-reader-secondary":
      return { type: GlobalDbMonitoringConnectionPriority.WRITER_OR_READER_SECONDARY };
    default:
      // Any unrecognized token is treated as a region literal. If it doesn't look like an AWS
      // region identifier, it is most likely a typo (e.g. "strict-wrtier-primary") that will
      // never match any host, so warn to aid diagnosis.
      if (!REGION_SHAPE.test(lower)) {
        logger.warn(Messages.get("GlobalDbMonitoringConnectionHandler.unrecognizedPriority", value));
      }
      return { type: GlobalDbMonitoringConnectionPriority.REGION, region: lower };
  }
}

export class GlobalDbMonitoringConnectionHandler extends AbstractMonitoringConnectionHandler<GlobalDbPriorityConfig> {
  private readonly rdsUtils: RdsUtils = new RdsUtils();
  private readonly accessibleRegions: string[] | null;
  private primaryRegion: string | null = null;
  private currentHostInfo: HostInfo | null = null;

  constructor(
    pluginService: PluginService,
    monitoringProperties: Map<string, any>,
    accessibleRegions: string[] | null,
    homeRegion: string | null,
    getMonitoringClient: () => ClientWrapper | null,
    setMonitoringClient: (client: ClientWrapper | null) => void
  ) {
    const priorities = GlobalDbMonitoringConnectionHandler.parsePriorities(
      WrapperProperties.GLOBAL_DB_MONITORING_CONNECTION_PRIORITY.get(monitoringProperties)
    );
    super(pluginService, monitoringProperties, priorities, getMonitoringClient, setMonitoringClient);
    this.accessibleRegions = accessibleRegions;
    logger.debug(Messages.get("GlobalDbMonitoringConnectionHandler.initialized", JSON.stringify(this.priorities)));
  }

  private static parsePriorities(value: string | null): GlobalDbPriorityConfig[] {
    if (!value) {
      return [{ type: GlobalDbMonitoringConnectionPriority.STRICT_WRITER_PRIMARY }];
    }
    const results: GlobalDbPriorityConfig[] = [];
    for (const part of value.split(",")) {
      const p = parseGlobalDbPriority(part.trim());
      if (p) {
        results.push(p);
      }
    }
    return results.length > 0 ? results : [{ type: GlobalDbMonitoringConnectionPriority.STRICT_WRITER_PRIMARY }];
  }

  override acceptConnection(client: ClientWrapper, isWriter: boolean, hostInfo: HostInfo): boolean {
    if (isWriter) {
      this.primaryRegion = this.getHostRegion(hostInfo);
    }
    const accepted = super.acceptConnection(client, isWriter, hostInfo);
    if (accepted) {
      this.currentHostInfo = hostInfo;
    }
    return accepted;
  }

  override acceptConnections(connections: Map<HostInfo, ClientWrapper>, writerHostInfo: HostInfo | null, topology: HostInfo[]): HostInfo | null {
    if (writerHostInfo) {
      this.primaryRegion = this.getHostRegion(writerHostInfo);
    }
    const selected = super.acceptConnections(connections, writerHostInfo, topology);
    if (selected) {
      this.currentHostInfo = selected;
    }
    return selected;
  }

  override async attemptConnectionUpgrade(currentTopology: HostInfo[]): Promise<void> {
    this.updatePrimaryRegion(currentTopology);
    if (this.currentPriorityIndex > 0 && this.currentHostInfo) {
      const newIndex = this.effectiveIndex(this.getPriorityIndex(this.currentHostInfo, this.currentHostInfo.role === HostRole.WRITER));
      if (newIndex < this.currentPriorityIndex) {
        this.currentPriorityIndex = newIndex;
      }
    }
    return super.attemptConnectionUpgrade(currentTopology);
  }

  protected getPriorityIndex(hostInfo: HostInfo, isWriter: boolean): number {
    for (let i = 0; i < this.priorities.length; i++) {
      if (this.isSatisfiedBy(this.priorities[i], hostInfo, isWriter)) {
        return i;
      }
    }
    return -1;
  }

  private isSatisfiedBy(priority: GlobalDbPriorityConfig, hostInfo: HostInfo, isWriter: boolean): boolean {
    switch (priority.type) {
      case GlobalDbMonitoringConnectionPriority.STRICT_WRITER_PRIMARY:
        return isWriter && this.isInPrimaryRegion(hostInfo);
      case GlobalDbMonitoringConnectionPriority.STRICT_WRITER_SECONDARY:
        return isWriter && !this.isInPrimaryRegion(hostInfo);
      case GlobalDbMonitoringConnectionPriority.STRICT_READER_PRIMARY:
        return !isWriter && this.isInPrimaryRegion(hostInfo);
      case GlobalDbMonitoringConnectionPriority.STRICT_READER_SECONDARY:
        return !isWriter && !this.isInPrimaryRegion(hostInfo);
      case GlobalDbMonitoringConnectionPriority.WRITER_OR_READER_PRIMARY:
        return this.isInPrimaryRegion(hostInfo);
      case GlobalDbMonitoringConnectionPriority.WRITER_OR_READER_SECONDARY:
        return !this.isInPrimaryRegion(hostInfo);
      case GlobalDbMonitoringConnectionPriority.REGION:
        return equalsIgnoreCase(this.getHostRegion(hostInfo), priority.region);
      default:
        return false;
    }
  }

  protected findHostsForPriority(priorityIndex: number, candidates: HostInfo[]): HostInfo[] {
    const priority = this.priorities[priorityIndex];
    if (!priority) {
      return [];
    }
    const filtered = this.filterAccessible(candidates);
    this.updatePrimaryRegion(filtered);
    switch (priority.type) {
      case GlobalDbMonitoringConnectionPriority.STRICT_WRITER_PRIMARY:
        return filtered.filter((h) => h.role === HostRole.WRITER && this.isInPrimaryRegion(h));

      case GlobalDbMonitoringConnectionPriority.STRICT_WRITER_SECONDARY:
        return filtered.filter((h) => h.role === HostRole.WRITER && !this.isInPrimaryRegion(h));

      case GlobalDbMonitoringConnectionPriority.STRICT_READER_PRIMARY:
        return filtered.filter((h) => h.role === HostRole.READER && this.isInPrimaryRegion(h));

      case GlobalDbMonitoringConnectionPriority.STRICT_READER_SECONDARY:
        return filtered.filter((h) => h.role === HostRole.READER && !this.isInPrimaryRegion(h));

      case GlobalDbMonitoringConnectionPriority.WRITER_OR_READER_PRIMARY: {
        const writers = filtered.filter((h) => h.role === HostRole.WRITER && this.isInPrimaryRegion(h));
        return writers.length > 0 ? writers : filtered.filter((h) => h.role === HostRole.READER && this.isInPrimaryRegion(h));
      }

      case GlobalDbMonitoringConnectionPriority.WRITER_OR_READER_SECONDARY: {
        const writers = filtered.filter((h) => h.role === HostRole.WRITER && !this.isInPrimaryRegion(h));
        return writers.length > 0 ? writers : filtered.filter((h) => h.role === HostRole.READER && !this.isInPrimaryRegion(h));
      }

      case GlobalDbMonitoringConnectionPriority.REGION: {
        const targetRegion = priority.region!;
        const writers = filtered.filter((h) => h.role === HostRole.WRITER && equalsIgnoreCase(this.getHostRegion(h), targetRegion));
        return writers.length > 0 ? writers : filtered.filter((h) => equalsIgnoreCase(this.getHostRegion(h), targetRegion));
      }

      default:
        return [];
    }
  }

  private filterAccessible(candidates: HostInfo[]): HostInfo[] {
    if (!this.accessibleRegions) {
      return candidates;
    }
    return candidates.filter((h) => {
      const region = this.rdsUtils.getRdsRegion(h.host);
      return region !== null && this.accessibleRegions!.includes(region.toLowerCase());
    });
  }

  private updatePrimaryRegion(candidates: HostInfo[]): void {
    const writer = candidates.find((h) => h.role === HostRole.WRITER);
    if (writer) {
      this.primaryRegion = this.getHostRegion(writer);
    }
  }

  private getHostRegion(host: HostInfo): string | null {
    return this.rdsUtils.getRdsRegion(host.host);
  }

  private isInPrimaryRegion(host: HostInfo): boolean {
    if (!this.primaryRegion) {
      return false;
    }
    const hostRegion = this.getHostRegion(host);
    return equalsIgnoreCase(this.primaryRegion, hostRegion);
  }
}
