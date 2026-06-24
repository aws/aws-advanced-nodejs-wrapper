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

import { ReadWriteSplittingPlugin } from "./read_write_splitting_plugin";
import { WrapperProperties } from "../../wrapper_property";
import { HostInfo } from "../../host_info";
import { RdsUtils } from "../../utils/rds_utils";
import { ReadWriteSplittingError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { logger } from "../../../logutils";
import { ClientWrapper } from "../../client_wrapper";
import { equalsIgnoreCase } from "../../utils/utils";
import { AccessibleRegions } from "../../utils/accessible_regions";

export class GdbReadWriteSplittingPlugin extends ReadWriteSplittingPlugin {
  protected readonly rdsUtils: RdsUtils = new RdsUtils();

  protected restrictWriterToHomeRegion: boolean;
  protected restrictReaderToHomeRegion: boolean;
  protected accessibleRegions: string[] | null = null;

  protected isInitialized: boolean = false;
  protected homeRegion: string;

  protected initSettings(initHostInfo: HostInfo, properties: Map<string, any>): void {
    if (this.isInitialized) {
      return;
    }
    this.restrictWriterToHomeRegion = WrapperProperties.GDB_RW_RESTRICT_WRITER_TO_HOME_REGION.get(properties);
    this.restrictReaderToHomeRegion = WrapperProperties.GDB_RW_RESTRICT_READER_TO_HOME_REGION.get(properties);

    this.homeRegion = WrapperProperties.GDB_RW_HOME_REGION.get(properties);
    if (!this.homeRegion) {
      const rdsUrlType = this.rdsUtils.identifyRdsType(initHostInfo.host);
      if (rdsUrlType.hasRegion) {
        this.homeRegion = this.rdsUtils.getRdsRegion(initHostInfo.host);
      }
    }

    if (!this.homeRegion) {
      throw new ReadWriteSplittingError(Messages.get("GdbReadWriteSplittingPlugin.missingHomeRegion", initHostInfo.host));
    }

    this.accessibleRegions = AccessibleRegions.parse(properties);
    if (this.accessibleRegions) {
      logger.debug(Messages.get("GdbReadWriteSplittingPlugin.parameterValue", "gdbAccessibleRegions", this.accessibleRegions.join(",")));

      // The home region must be reachable. If it is excluded from the accessible regions, every
      // reader/writer selection would filter it out, so fail loudly at connect time rather than
      // surfacing confusing "no available hosts" errors later.
      if (!this.accessibleRegions.includes(this.homeRegion.toLowerCase())) {
        throw new ReadWriteSplittingError(
          Messages.get("Gdb.homeRegionNotAccessible", this.homeRegion, this.accessibleRegions.join(","))
        );
      }
    }

    logger.debug(Messages.get("GdbReadWriteSplittingPlugin.parameterValue", "gdbRwHomeRegion", this.homeRegion));

    this.isInitialized = true;
  }

  override async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    this.initSettings(hostInfo, props);
    return super.connect(hostInfo, props, isInitialConnection, connectFunc);
  }

  override setWriterClient(writerTargetClient: ClientWrapper | undefined, writerHostInfo: HostInfo) {
    if (writerHostInfo != null && !this.isHostInAccessibleRegion(writerHostInfo)) {
      const writerRegion = this.rdsUtils.getRdsRegion(writerHostInfo.host) ?? "unknown";
      throw new ReadWriteSplittingError(Messages.get("GdbReadWriteSplittingPlugin.writerInInaccessibleRegion", writerHostInfo.host, writerRegion));
    }

    if (
      this.restrictWriterToHomeRegion &&
      writerHostInfo != null &&
      !equalsIgnoreCase(this.rdsUtils.getRdsRegion(writerHostInfo.host), this.homeRegion)
    ) {
      throw new ReadWriteSplittingError(
        Messages.get("GdbReadWriteSplittingPlugin.cantConnectWriterOutOfHomeRegion", writerHostInfo.host, this.homeRegion)
      );
    }
    super.setWriterClient(writerTargetClient, writerHostInfo);
  }

  protected getReaderHostCandidates(): HostInfo[] {
    let candidates = this.pluginService.getHosts();

    if (this.accessibleRegions) {
      candidates = candidates.filter((x) => this.isHostInAccessibleRegion(x));
    }

    if (this.restrictReaderToHomeRegion) {
      const hostsInRegion = candidates.filter((x) => equalsIgnoreCase(this.rdsUtils.getRdsRegion(x.host), this.homeRegion));

      if (hostsInRegion.length === 0) {
        throw new ReadWriteSplittingError(Messages.get("GdbReadWriteSplittingPlugin.noAvailableReadersInHomeRegion", this.homeRegion));
      }
      return hostsInRegion;
    }

    if (this.accessibleRegions && candidates.length === 0) {
      throw new ReadWriteSplittingError(
        Messages.get("GdbReadWriteSplittingPlugin.noAvailableReadersInAccessibleRegions", this.accessibleRegions.join(","))
      );
    }

    return candidates.length > 0 ? candidates : super.getReaderHostCandidates();
  }

  private isHostInAccessibleRegion(host: HostInfo): boolean {
    if (!this.accessibleRegions) {
      return true;
    }
    const hostRegion = this.rdsUtils.getRdsRegion(host.host);
    return hostRegion !== null && this.accessibleRegions.includes(hostRegion.toLowerCase());
  }
}
