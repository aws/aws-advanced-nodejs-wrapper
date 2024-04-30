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

import { logger } from "../../logutils";
import { HostInfo } from "../host_info";
import { HostListProviderService } from "../host_list_provider_service";
import { HostRole } from "../host_role";
import { PluginService } from "../plugin_service";
import { Messages } from "../utils/messages";
import { RdsUtils } from "../utils/rds_utils";
import { lookup } from "dns";
import { promisify } from "util";
import { AwsWrapperError } from "../utils/errors";

export class StaleDnsHelper {
  private readonly pluginService: PluginService;
  private readonly rdsUtils: RdsUtils = new RdsUtils();
  private writerHostInfo: HostInfo | null = null;
  private writerHostAddress: string = "";

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
  }

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

    const currentHostInfo = this.pluginService.getCurrentHostInfo();
    if (!currentHostInfo) {
      throw new AwsWrapperError("Could not find current hostInfo");
    }

    let result;
    let currentTargetClient;
    try {
      result = await connectFunc();
      currentTargetClient = this.pluginService.getCurrentClient().targetClient;
    } catch (error: any) {
      await this.pluginService.tryClosingTargetClient(currentTargetClient);
      throw error;
    }

    if (!currentTargetClient) {
      throw new Error("Could not find current targetClient");
    }

    let clusterInetAddress = "";
    try {
      const lookupResult = await promisify(lookup)(host, {});
      clusterInetAddress = lookupResult.address;
    } catch (error) {
      // ignore
    }

    const hostInetAddress = clusterInetAddress;
    logger.debug(Messages.get("AuroraStaleDnsHelper.clusterEndpointDns", hostInetAddress));

    if (!clusterInetAddress) {
      this.pluginService.setCurrentClient(currentTargetClient, currentHostInfo);
      return result;
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
        this.pluginService.setCurrentClient(currentTargetClient, currentHostInfo);
        return result;
      }
      this.writerHostInfo = writerCandidate;
    }

    logger.debug(Messages.get("AuroraStaleDnsHelper.writerHostSpec", this.writerHostInfo?.host ?? ""));

    if (!this.writerHostInfo) {
      this.pluginService.setCurrentClient(currentTargetClient, currentHostInfo);
      return result;
    }

    if (!this.writerHostAddress) {
      try {
        const lookupResult = await promisify(lookup)(this.writerHostInfo.host, {});
        this.writerHostAddress = lookupResult.address;
      } catch (error) {
        // ignore
      }
    }

    logger.debug(Messages.get("AuroraStaleDnsHelper.writerInetAddress", this.writerHostAddress));

    if (!this.writerHostAddress) {
      this.pluginService.setCurrentClient(currentTargetClient, currentHostInfo);
      return result;
    }

    if (this.writerHostAddress !== clusterInetAddress) {
      // DNS resolves a cluster endpoint to a wrong writer
      // opens a connection to a proper writer node
      logger.debug(Messages.get("AuroraStaleDnsHelper.staleDnsDetected", this.writerHostInfo.toString()));

      const targetClient = this.pluginService.createTargetClient(props);

      try {
        result = await this.pluginService.connect(this.writerHostInfo, props, this.pluginService.getDialect().getConnectFunc(targetClient));
        await this.pluginService.tryClosingTargetClient(currentTargetClient);
        await this.pluginService.setCurrentClient(targetClient, this.writerHostInfo);
        return result;
      } catch (error: any) {
        await this.pluginService.tryClosingTargetClient(targetClient);
      }

      if (isInitialConnection) {
        hostListProviderService.setInitialConnectionHostInfo(this.writerHostInfo);
      }
    }

    this.pluginService.setCurrentClient(currentTargetClient, currentHostInfo);
    return result;
  }

  private getWriter(): HostInfo | null {
    for (const host of this.pluginService.getHosts()) {
      if (host.role === HostRole.WRITER) {
        return host;
      }
    }
    return null;
  }
}

export class StaleDnsPlugin {}
