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

import { AwsClient } from "../aws_client";
import { HostAvailability } from "../host_availability/host_availability";
import { HostInfo } from "../host_info";
import { HostListProviderService } from "../host_list_provider_service";
import { HostRole } from "../host_role";
import { AwsWrapperError } from "../utils/errors";
import { ConnectionUrlParser } from "../utils/connection_url_parser";
import { Messages } from "../utils/messages";
import { WrapperProperties } from "../wrapper_property";
import { StaticHostListProvider } from "./host_list_provider";
import { ClientWrapper } from "../client_wrapper";

export class ConnectionStringHostListProvider implements StaticHostListProvider {
  hostList: HostInfo[] = [];
  private isInitialized = false;
  private initialHost: string;
  private initialPort;
  private readonly isSingleWriterConnectionString: boolean;
  private readonly connectionUrlParser: ConnectionUrlParser;
  private readonly hostListProviderService: HostListProviderService;

  constructor(props: Map<string, any>, initialHost: string, defaultPort: number, hostListProviderService: HostListProviderService) {
    this.isSingleWriterConnectionString = WrapperProperties.SINGLE_WRITER_CONNECTION_STRING.get(props);
    this.initialHost = initialHost;
    this.initialPort = defaultPort;
    this.hostListProviderService = hostListProviderService;
    this.connectionUrlParser = hostListProviderService.getConnectionUrlParser();
    const port = WrapperProperties.PORT.get(props);
    if (port != null) {
      this.initialPort = port;
    }
  }

  init() {
    if (this.isInitialized) {
      return;
    }

    this.hostList.push(
      ...this.connectionUrlParser.getHostsFromConnectionUrl(this.initialHost, this.isSingleWriterConnectionString, this.initialPort, () =>
        this.hostListProviderService.getHostInfoBuilder()
      )
    );

    if (this.hostList && this.hostList.length == 0) {
      throw new AwsWrapperError(Messages.get("ConnectionStringHostListProvider.parsedListEmpty", this.initialHost));
    }

    this.hostListProviderService.setInitialConnectionHostInfo(this.hostList[0]);
    this.isInitialized = true;
  }

  refresh(): Promise<HostInfo[]>;
  refresh(client: ClientWrapper): Promise<HostInfo[]>;
  refresh(client?: ClientWrapper): Promise<HostInfo[]>;
  refresh(client?: ClientWrapper | undefined): Promise<HostInfo[]> {
    this.init();
    return Promise.resolve(this.hostList);
  }

  forceRefresh(): Promise<HostInfo[]>;
  forceRefresh(client: ClientWrapper): Promise<HostInfo[]>;
  forceRefresh(client?: ClientWrapper): Promise<HostInfo[]> {
    this.init();
    return Promise.resolve(this.hostList);
  }

  getHostRole(client: AwsClient): Promise<HostRole> {
    throw new AwsWrapperError("ConnectionStringHostListProvider does not support getHostRole.");
  }

  async identifyConnection(client: ClientWrapper): Promise<HostInfo | void | null> {
    if (!client.client) {
      return null;
    }
    const instance = await this.hostListProviderService.getDialect().getHostAliasAndParseResults(client.client);
    const topology = await this.refresh(client.client);
    if (!topology || topology.length == 0) {
      return null;
    }

    return topology.filter((hostInfo) => instance === hostInfo.hostId)[0];
  }

  createHost(host: string, isWriter: boolean, weight: number, lastUpdateTime: number): HostInfo {
    return this.hostListProviderService
      .getHostInfoBuilder()
      .withHost(host ?? "")
      .withPort(this.initialPort)
      .withRole(isWriter ? HostRole.WRITER : HostRole.READER)
      .withAvailability(HostAvailability.AVAILABLE)
      .withWeight(weight)
      .withLastUpdateTime(lastUpdateTime)
      .withHostId(host)
      .build();
  }

  getHostProviderType(): string {
    return this.constructor.name;
  }
}
