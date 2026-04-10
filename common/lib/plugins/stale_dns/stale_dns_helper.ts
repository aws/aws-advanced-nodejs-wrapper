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

import { levels, logger } from "../../../logutils";
import { HostInfo } from "../../host_info";
import { HostListProviderService } from "../../host_list_provider_service";
import { HostRole } from "../../host_role";
import { PluginService } from "../../plugin_service";
import { Messages } from "../../utils/messages";
import { RdsUtils } from "../../utils/rds_utils";
import { HostChangeOptions } from "../../host_change_options";
import { WrapperProperties } from "../../wrapper_property";
import { ClientWrapper } from "../../client_wrapper";
import { containsHostAndPort, getWriter, logTopology } from "../../utils/utils";
import { TelemetryFactory } from "../../utils/telemetry/telemetry_factory";
import { TelemetryCounter } from "../../utils/telemetry/telemetry_counter";
import { RdsUrlType } from "../../utils/rds_url_type";
import { AwsWrapperError } from "../../utils/errors";

export class StaleDnsHelper {
  private readonly pluginService: PluginService;
  private readonly rdsUtils: RdsUtils = new RdsUtils();
  private writerHostInfo: HostInfo | null = null;
  private readonly telemetryFactory: TelemetryFactory;
  private readonly staleDNSDetectedCounter: TelemetryCounter;

  constructor(pluginService: PluginService) {
    this.pluginService = pluginService;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();
    this.staleDNSDetectedCounter = this.telemetryFactory.createCounter("staleDNS.stale.detected");
  }

  // Follow the returns and throws
  async getVerifiedConnection<Type>(
    host: string,
    isInitialConnection: boolean,
    hostListProviderService: HostListProviderService,
    props: Map<string, any>,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    const type: RdsUrlType = this.rdsUtils.identifyRdsType(host);

    if (type !== RdsUrlType.RDS_WRITER_CLUSTER && type !== RdsUrlType.RDS_GLOBAL_WRITER_CLUSTER) {
      return connectFunc();
    }

    if (type === RdsUrlType.RDS_WRITER_CLUSTER) {
      const writer = getWriter(this.pluginService.getAllHosts());
      if (writer != null && this.rdsUtils.isRdsInstance(writer.host)) {
        if (
          isInitialConnection &&
          WrapperProperties.SKIP_INACTIVE_WRITER_CLUSTER_CHECK.get(props) &&
          !this.rdsUtils.isSameRegion(writer.host, host)
        ) {
          // The cluster writer endpoint belongs to a different region than the current writer region.
          // It means that the cluster is Aurora Global Database and cluster writer endpoint is in secondary region.
          // In this case the cluster writer endpoint is in inactive state and doesn't represent the current writer
          // so any connection check should be skipped.
          // Continue with a normal workflow.
          return connectFunc();
        }
      } else {
        // No writer is available. It could be the case with the first connection when topology isn't yet available.
        // Continue with a normal workflow.
        return connectFunc();
      }
    }

    const currentTargetClient = await connectFunc();

    const isConnectedToReader: boolean = (await this.pluginService.getHostRole(currentTargetClient)) === HostRole.READER;
    if (isConnectedToReader) {
      // This is if-statement is only reached if the connection url is a writer cluster endpoint.
      // If the new connection resolves to a reader instance, this means the topology is outdated.
      // Force refresh to update the topology.
      await this.pluginService.forceRefreshHostList();
    } else {
      await this.pluginService.refreshHostList();
    }

    logger.debug(logTopology(this.pluginService.getAllHosts(), "[StaleDnsHelper.getVerifiedConnection] "));

    if (!this.writerHostInfo) {
      const writerCandidate = getWriter(this.pluginService.getHosts());
      if (writerCandidate && this.rdsUtils.isRdsClusterDns(writerCandidate.host)) {
        return currentTargetClient;
      }
      this.writerHostInfo = writerCandidate;
    }

    logger.debug(Messages.get("StaleDnsHelper.writerHostInfo", this.writerHostInfo?.host ?? ""));

    if (!this.writerHostInfo) {
      return currentTargetClient;
    }

    if (isConnectedToReader) {
      // Reconnect to writer host if current connection is reader.

      logger.debug(Messages.get("StaleDnsHelper.staleDnsDetected", this.writerHostInfo.host));
      this.staleDNSDetectedCounter.inc();

      const allowedHosts: HostInfo[] = this.pluginService.getHosts();

      if (!containsHostAndPort(allowedHosts, this.writerHostInfo.hostAndPort)) {
        throw new AwsWrapperError(Messages.get("StaleDnsHelper.currentWriterNotAllowed", this.writerHostInfo.host, logTopology(allowedHosts, "")));
      }

      let targetClient = null;
      try {
        const newProps = new Map<string, any>(props);
        newProps.set(WrapperProperties.HOST.name, this.writerHostInfo.host);
        targetClient = await this.pluginService.connect(this.writerHostInfo, newProps);
        await this.pluginService.abortTargetClient(currentTargetClient);

        if (isInitialConnection) {
          hostListProviderService.setInitialConnectionHostInfo(this.writerHostInfo);
        }
        return targetClient;
      } catch (error: any) {
        await this.pluginService.abortTargetClient(targetClient);
      }
    }
    return currentTargetClient;
  }

  notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): Promise<void> {
    if (!this.writerHostInfo) {
      return Promise.resolve();
    }

    for (const [key, values] of changes.entries()) {
      if (levels[logger.level] <= levels.debug) {
        const valStr = Array.from(values)
          .map((x) => HostChangeOptions[x])
          .join(", ");
        logger.debug(`[${key}]: ${valStr}`);
      }
      if (this.writerHostInfo) {
        if (key === this.writerHostInfo.url && values.has(HostChangeOptions.PROMOTED_TO_READER)) {
          logger.debug(Messages.get("StaleDnsHelper.reset"));
          this.writerHostInfo = null;
        }
      }
    }
    return Promise.resolve();
  }
}
