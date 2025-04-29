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

import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { PluginService } from "../plugin_service";
import { HostListProviderService } from "../host_list_provider_service";
import { RdsUtils } from "../utils/rds_utils";
import { HostInfo } from "../host_info";
import { HostRole } from "../host_role";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";
import { RdsUrlType } from "../utils/rds_url_type";
import { WrapperProperties } from "../wrapper_property";
import { sleep } from "../utils/utils";
import { HostAvailability } from "../host_availability/host_availability";
import { logger } from "../../logutils";
import { ClientWrapper } from "../client_wrapper";

export class AuroraInitialConnectionStrategyPlugin extends AbstractConnectionPlugin {
  private static readonly subscribedMethods = new Set<string>(["initHostProvider", "connect", "forceConnect"]);
  private pluginService: PluginService;
  private hostListProviderService?: HostListProviderService;
  private rdsUtils = new RdsUtils();

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;
  }

  override getSubscribedMethods(): Set<string> {
    return AuroraInitialConnectionStrategyPlugin.subscribedMethods;
  }

  initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    this.hostListProviderService = hostListProviderService;
    if (hostListProviderService.isStaticHostListProvider()) {
      throw new AwsWrapperError(Messages.get("AuroraInitialConnectionStrategyPlugin.requireDynamicProvider"));
    }
    initHostProviderFunc();
  }

  async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(hostInfo, props, isInitialConnection, connectFunc);
  }

  async forceConnect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(hostInfo, props, isInitialConnection, forceConnectFunc);
  }

  async connectInternal(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    const type = this.rdsUtils.identifyRdsType(hostInfo.host);

    if (!type.isRdsCluster) {
      // It's not a cluster endpoint. Continue with a normal workflow.
      return connectFunc();
    }

    if (type === RdsUrlType.RDS_WRITER_CLUSTER) {
      const writerCandidateClient = await this.getVerifiedWriterClient(props, isInitialConnection, connectFunc);
      if (writerCandidateClient === null) {
        // Can't get writer connection. Continue with a normal workflow.
        logger.debug("Writer cluster endpoint does not resolve to a valid reader instance, skipping the initial connection strategy logic.");
        return connectFunc();
      }
      return writerCandidateClient;
    }

    if (type === RdsUrlType.RDS_READER_CLUSTER) {
      const readerCandidateClient = await this.getVerifiedReaderClient(props, isInitialConnection, connectFunc);
      if (readerCandidateClient === null) {
        // Can't get a reader connection. Continue with a normal workflow.
        logger.debug("Reader cluster endpoint does not resolve to a valid reader instance, skipping the initial connection strategy logic.");
        return connectFunc();
      }
      return readerCandidateClient;
    }
    // Continue with normal workflow
    return connectFunc();
  }

  async getVerifiedWriterClient<T>(props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<any> {
    if (!this.hostListProviderService) {
      throw new AwsWrapperError(Messages.get("HostListProviderService.notFound")); // should not be reached
    }
    const retryDelayMs = WrapperProperties.OPEN_CONNECTION_RETRY_INTERVAL_MS.get(props);

    const endTimeMillis = Date.now() + WrapperProperties.OPEN_CONNECTION_RETRY_TIMEOUT_MS.get(props);
    let writerCandidateClient: any;
    let writerCandidate: HostInfo | void | null;

    while (Date.now() < endTimeMillis) {
      writerCandidateClient = null;
      writerCandidate = null;

      try {
        writerCandidate = this.getWriter();

        if (writerCandidate === null || this.rdsUtils.isRdsClusterDns(writerCandidate.host)) {
          // Writer is not found. It seems that topology is outdated.
          writerCandidateClient = await connectFunc();
          await this.pluginService.forceRefreshHostList(writerCandidateClient);
          writerCandidate = await this.pluginService.identifyConnection(writerCandidateClient);

          if (writerCandidate) {
            if (writerCandidate.role !== HostRole.WRITER) {
              // Shouldn't be here. But let's try again.
              await this.pluginService.abortTargetClient(writerCandidateClient);
              await sleep(retryDelayMs);
              continue;
            }

            if (isInitialConnection) {
              this.hostListProviderService.setInitialConnectionHostInfo(writerCandidate);
            }
          }
          return writerCandidateClient;
        }
        writerCandidateClient = await this.pluginService.connect(writerCandidate, props);

        if ((await this.pluginService.getHostRole(writerCandidateClient)) !== HostRole.WRITER) {
          // If the new connection resolves to a reader instance, this means the topology is outdated.
          // Force refresh to update the topology.
          await this.pluginService.forceRefreshHostList(writerCandidateClient);
          await this.pluginService.abortTargetClient(writerCandidateClient);
          await sleep(retryDelayMs);
          continue;
        }

        // Writer connection is valid and verified.
        if (isInitialConnection) {
          this.hostListProviderService.setInitialConnectionHostInfo(writerCandidate);
        }
        return writerCandidateClient;
      } catch (error: any) {
        await this.pluginService.abortTargetClient(writerCandidateClient);
        if (this.pluginService.isLoginError(error) || !writerCandidate) {
          throw error;
        } else if (writerCandidate) {
          this.pluginService.setAvailability(writerCandidate.allAliases, HostAvailability.NOT_AVAILABLE);
        }
      }
    }
  }

  async getVerifiedReaderClient<T>(props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<any> {
    if (!this.hostListProviderService) {
      throw new AwsWrapperError(Messages.get("HostListProviderService.notFound")); // should not be reached
    }

    const retryDelayMs = WrapperProperties.OPEN_CONNECTION_RETRY_INTERVAL_MS.get(props);
    const endTimeMs = Date.now() + WrapperProperties.OPEN_CONNECTION_RETRY_TIMEOUT_MS.get(props);

    let readerCandidateClient: any;
    let readerCandidate: HostInfo | void | null;

    while (Date.now() < endTimeMs) {
      readerCandidateClient = null;
      readerCandidate = null;

      try {
        readerCandidateClient = await connectFunc();
        await this.pluginService.forceRefreshHostList(readerCandidateClient);
        readerCandidate = await this.pluginService.identifyConnection(readerCandidateClient);
        readerCandidate = this.getReader(props);
        // convert into null if undefined
        readerCandidate = readerCandidate ?? null;
        if (readerCandidate === null || this.rdsUtils.isRdsClusterDns(readerCandidate.host)) {
          if (readerCandidate) {
            if (readerCandidate.role !== HostRole.READER) {
              if (this.hasNoReaders()) {
                // It seems that cluster has no readers. Simulate Aurora reader cluster endpoint logic
                // and return the current (writer) client.
                if (isInitialConnection) {
                  this.hostListProviderService.setInitialConnectionHostInfo(readerCandidate);
                }
                return readerCandidateClient;
              }
              await this.pluginService.abortTargetClient(readerCandidateClient);
              await sleep(retryDelayMs);
              continue;
            }

            // Reader connection is valid and verified.
            if (isInitialConnection) {
              this.hostListProviderService.setInitialConnectionHostInfo(readerCandidate);
            }
          } else {
            logger.debug("Reader candidate not found");
          }
        }
        readerCandidateClient = await this.pluginService.connect(readerCandidate, props);

        if ((await this.pluginService.getHostRole(readerCandidateClient)) !== HostRole.READER) {
          // If the new connection resolves to a writer instance, this means the topology is outdated.
          // Force refresh to update the topology.
          await this.pluginService.forceRefreshHostList(readerCandidateClient);

          if (this.hasNoReaders()) {
            // It seems that cluster has no readers. Simulate Aurora reader cluster endpoint logic
            // and return the current (writer) client.
            if (isInitialConnection) {
              this.hostListProviderService.setInitialConnectionHostInfo(readerCandidate);
            }
            return readerCandidateClient;
          }
          await this.pluginService.abortTargetClient(readerCandidateClient);
          await sleep(retryDelayMs);
          continue;
        }
        // Reader connection is valid and verified.
        if (isInitialConnection) {
          this.hostListProviderService.setInitialConnectionHostInfo(readerCandidate);
        }
        return readerCandidateClient;
      } catch (error: any) {
        await this.pluginService.abortTargetClient(readerCandidateClient);
        if (this.pluginService.isLoginError(error) || !readerCandidate) {
          throw error;
        } else if (readerCandidate) {
          this.pluginService.setAvailability(readerCandidate.allAliases, HostAvailability.NOT_AVAILABLE);
        }
      }
    }
  }

  private getWriter(): HostInfo | null {
    return this.pluginService.getAllHosts().find((x) => x.role === HostRole.WRITER) ?? null;
  }

  private getReader(props: Map<string, any>): HostInfo | undefined {
    const strategy = WrapperProperties.READER_HOST_SELECTOR_STRATEGY.get(props);
    if (this.pluginService.acceptsStrategy(HostRole.READER, strategy)) {
      try {
        return this.pluginService.getHostInfoByStrategy(HostRole.READER, strategy);
      } catch (error: any) {
        // Host isn't found
        logger.error(error.message);
      }
    }
    throw new AwsWrapperError(Messages.get("AuroraInitialConnectionStrategyPlugin.unsupportedStrategy", strategy));
  }

  private hasNoReaders(): boolean {
    return this.pluginService.getAllHosts().find((x) => x.role === HostRole.READER) !== undefined;
  }
}
