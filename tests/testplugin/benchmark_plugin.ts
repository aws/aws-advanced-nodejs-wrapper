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

import { ConnectionPlugin } from "../../common/lib";
import { logger } from "../../common/logutils";
import { HostInfo } from "../../common/lib/host_info";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { HostChangeOptions } from "../../common/lib/host_change_options";
import { OldConnectionSuggestionAction } from "../../common/lib/old_connection_suggestion_action";
import { HostRole } from "../../common/lib/host_role";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";

export class BenchmarkPlugin implements ConnectionPlugin {
  // TODO Uncomment resources related changes once releaseResources implemented
  // resources: Array<string> = new Array<string>();

  getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);
  }

  async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any): Promise<T> {
    logger.debug(`execute method = ${methodName}`);
    // this.resources.push("execute");
    return methodFunc();
  }

  async connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    logger.debug(`connect = ${hostInfo.host}`);
    // this.resources.push("connect");
    return connectFunc();
  }

  async forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    logger.debug(`forceConnect = ${hostInfo.host}`);
    // this.resources.push("forceConnect");
    return forceConnectFunc();
  }

  initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    logger.debug(`initHostProvider = ${hostInfo.host}`);
    // this.resources.push("initHostProvider");
  }

  notifyConnectionChanged(changes: Set<HostChangeOptions>): OldConnectionSuggestionAction {
    logger.debug(`notifyConnectionChanged = ${JSON.stringify(Array.from(changes))}`);
    return OldConnectionSuggestionAction.NO_OPINION;
  }

  notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): void {
    logger.debug(`notifyHostListChanged = ${JSON.stringify(Array.from(changes))}`);
    // this.resources.push("notifyHostListChanged");
  }

  acceptsStrategy(role: HostRole, strategy: string): boolean {
    return false;
  }

  getHostInfoByStrategy(role: HostRole, strategy: string): HostInfo | undefined {
    logger.debug(`getHostInfoByStrategy = ${strategy}`);
    // this.resources.push("getHostInfoByStrategy");
    return new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() })
      .withHost("host")
      .withPort(1234)
      .withRole(role)
      .build();
  }

  // releaseResources(): void {
  //   while (this.resources.length > 0) {
  //     this.resources.pop();
  //   }
  // }
}
