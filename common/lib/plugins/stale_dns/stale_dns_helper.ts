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

import { logger } from "../../../logutils";
import { HostInfo } from "../../host_info";
import { HostListProviderService } from "../../host_list_provider_service";
import { HostRole } from "../../host_role";
import { PluginService } from "../../plugin_service";
import { Messages } from "../../utils/messages";
import { RdsUtils } from "../../utils/rds_utils";
import { LookupAddress, lookup } from "dns";
import { promisify } from "util";
import { AwsWrapperError } from "../../utils/errors";
import { HostChangeOptions } from "../../host_change_options";

export class StaleDnsHelper {
  private readonly pluginService: PluginService;
  private readonly rdsUtils: RdsUtils = new RdsUtils();
  private writerHostInfo: HostInfo | null = null;
  private writerHostAddress: string = "";

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
  }

  // TODO review changes/implementation
  // Note important difference!!! This function was calling pluginService.setCurrentClient. Now it just returns the connection/target client
  // Follow the returns and throws
  async getVerifiedConnection<Type>(
    host: string,
    isInitialConnection: boolean,
    hostListProviderService: HostListProviderService,
    props: Map<string, any>,
    connectFunc: () => Type
  ): Promise<Type> {
    if (!this.rdsUtils.isWriterClusterDns(host)) {
      return connectFunc();
    }

    // TODO review: the currentHostInfo variable is only used starting with the 
    // if (currentHostInfo && currentHostInfo.role === HostRole.READER) below around line 88
    // should this call and check be done just before that if statement or the code leading to that should also be not executed
    // in the event where !currentHostInfo?
    const currentHostInfo = this.pluginService.getCurrentHostInfo();
    if (!currentHostInfo) {
      throw new AwsWrapperError("Could not find current hostInfo");
    }

    let currentTargetClient;
    try {
      currentTargetClient = await connectFunc();
    } catch (error: any) {
      throw error;
    }

    if (!currentTargetClient) {
      throw new Error("Connect failed");
    }

    let clusterInetAddress = "";
    try {
      const lookupResult = await this.lookupResult(host);
      clusterInetAddress = lookupResult.address;
    } catch (error) {
      // ignore
    }

    const hostInetAddress = clusterInetAddress;
    logger.debug(Messages.get("StaleDnsHelper.clusterEndpointDns", hostInetAddress));

    if (!clusterInetAddress) {
      return currentTargetClient;
    }

    if (currentHostInfo && currentHostInfo.role === HostRole.READER) {
      // This is if-statement is only reached if the connection url is a writer cluster endpoint.
      // If the new connection resolves to a reader instance, this means the topology is outdated.
      // Force refresh to update the topology.
      await this.pluginService.forceRefreshHostList(currentTargetClient);
    } else {
      await this.pluginService.refreshHostList(currentTargetClient);
    }

    logger.debug(this.pluginService.getHosts());
    if (!this.writerHostInfo) {
      const writerCandidate = this.getWriter();
      if (writerCandidate && this.rdsUtils.isRdsClusterDns(writerCandidate.host)) { 
        return currentTargetClient;
      }
      this.writerHostInfo = writerCandidate;
    }

    logger.debug(Messages.get("StaleDnsHelper.writerHostInfo", this.writerHostInfo?.host ?? ""));

    if (!this.writerHostInfo) {
      return currentTargetClient;
    }

    if (!this.writerHostAddress) {
      try {
        const lookupResult = await this.lookupResult(this.writerHostInfo.host);
        this.writerHostAddress = lookupResult.address;
      } catch (error) {
        // ignore
      }
    }

    logger.debug(Messages.get("StaleDnsHelper.writerInetAddress", this.writerHostAddress));

    if (!this.writerHostAddress) {
      return currentTargetClient;
    }

    if (this.writerHostAddress !== clusterInetAddress) {
      // DNS resolves a cluster endpoint to a wrong writer
      // opens a connection to a proper writer node
      logger.debug(Messages.get("StaleDnsHelper.staleDnsDetected", this.writerHostInfo.host));

      let targetClient;
      try {
        // Just note, the call below will trigger the plugin chain again and will invoke this function from top  todo: delete this comment later.
        targetClient = await this.pluginService.connect(this.writerHostInfo, props);
        await this.pluginService.tryClosingTargetClient(currentTargetClient);  
        //await this.pluginService.setCurrentClient(targetClient, this.writerHostInfo);

        // TODO review: Since we're not calling the pluginService.setCurrentClient here any more, just returning new targetClient
        // the pluginService.setCurrentClient is called later. However! The pluginService.setCurrentClient takes the HostInfo as parameter
        // and sets this._currentHostInfo = hostInfo; internally.  
        // This means that the this.writerHostInfo would not be properly set later because we're not returning it, thus loosing the correct hostInfo information?
        if (isInitialConnection) {
          hostListProviderService.setInitialConnectionHostInfo(this.writerHostInfo);
        }
        return targetClient;
      } catch (error: any) {
        await this.pluginService.tryClosingTargetClient(targetClient);
      }
    }
    return currentTargetClient;
  }

  private getWriter(): HostInfo | null {
    for (const host of this.pluginService.getHosts()) {
      if (host.role === HostRole.WRITER) {
        return host;
      }
    }
    return null;
  }

  notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): void {
    if (!this.writerHostInfo) {
      return;
    }

    for (const [key, values] of changes.entries()) {
      if (logger.level === "debug") {
        const valStr = Array.from(values)
          .map((x) => HostChangeOptions[x])
          .join(", ");
        logger.debug(`[${key}]: ${valStr}`);
      }
      if (this.writerHostInfo) {
        if (key === this.writerHostInfo.url && values.has(HostChangeOptions.PROMOTED_TO_READER)) {
          logger.debug(Messages.get("StaleDnsHelper.reset"));
          this.writerHostInfo = null;
          this.writerHostAddress = "";
        }
      }
    }
  }

  lookupResult(host: string): Promise<LookupAddress> {
    return promisify(lookup)(host, {});
  }
}
