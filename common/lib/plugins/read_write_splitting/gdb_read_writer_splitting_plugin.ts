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
import { PluginService } from "../../plugin_service";
import { WrapperProperties } from "../../wrapper_property";
import { HostInfo } from "../../host_info";
import { RdsUtils } from "../../utils/rds_utils";
import { ReadWriteSplittingError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { logger } from "../../../logutils";
import { ClientWrapper } from "../../client_wrapper";
import { equalsIgnoreCase } from "../../utils/utils";
import { FullServicesContainer } from "../../utils/full_services_container";

export class GdbReadWriteSplittingPlugin extends ReadWriteSplittingPlugin {
  protected readonly rdsUtils: RdsUtils = new RdsUtils();

  protected readonly restrictWriterToHomeRegion: boolean;
  protected readonly restrictReaderToHomeRegion: boolean;

  protected isInitialized: boolean = false;
  protected homeRegion: string;

  constructor(serviceContainer: FullServicesContainer, properties: Map<string, any>) {
    super(serviceContainer, properties);
    this.restrictWriterToHomeRegion = WrapperProperties.GDB_RW_RESTRICT_WRITER_TO_HOME_REGION.get(properties);
    this.restrictReaderToHomeRegion = WrapperProperties.GDB_RW_RESTRICT_READER_TO_HOME_REGION.get(properties);
  }

  protected initSettings(initHostInfo: HostInfo, properties: Map<string, any>): void {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;

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

    logger.debug(Messages.get("GdbReadWriteSplittingPlugin.parameterValue", "gdbRwHomeRegion", this.homeRegion));
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
    if (
      this.restrictWriterToHomeRegion &&
      this.writerHostInfo != null &&
      !equalsIgnoreCase(this.rdsUtils.getRdsRegion(this.writerHostInfo.host), this.homeRegion)
    ) {
      throw new ReadWriteSplittingError(
        Messages.get("GdbReadWriteSplittingPlugin.cantConnectWriterOutOfHomeRegion", writerHostInfo.host, this.homeRegion)
      );
    }
    super.setWriterClient(writerTargetClient, writerHostInfo);
  }

  protected getReaderHostCandidates(): HostInfo[] {
    if (this.restrictReaderToHomeRegion) {
      const hostsInRegion: HostInfo[] = this.pluginService
        .getHosts()
        .filter((x) => equalsIgnoreCase(this.rdsUtils.getRdsRegion(x.host), this.homeRegion));

      if (hostsInRegion.length === 0) {
        throw new ReadWriteSplittingError(Messages.get("GdbReadWriteSplittingPlugin.noAvailableReadersInHomeRegion", this.homeRegion));
      }
      return hostsInRegion;
    }
    return super.getReaderHostCandidates();
  }
}
