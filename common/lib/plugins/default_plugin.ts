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

import { uniqueId } from "lodash";
import { performance } from "perf_hooks";
import { logger } from "../../logutils";
import { Messages } from "../utils/messages";
import { HostListProviderService } from "../host_list_provider_service";
import { HostInfo } from "../host_info";
import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { HostRole } from "../host_role";

export class DefaultPlugin extends AbstractConnectionPlugin {
  id: string = uniqueId("_defaultPlugin");

  override getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);
  }

  override forceConnect<Type>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Type): Type {
    throw new Error("Method not implemented.");
  }

  override initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    // do nothing
  }

  override connect<Type>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Type): Type {
    logger.debug(`Start connect for test plugin: ${this.id}`);
    return connectFunc();
  }

  override execute<Type>(methodName: string, methodFunc: () => Type): Type {
    logger.debug(Messages.get("DefaultPlugin.executingMethod", methodName));
    return methodFunc();
  }

  override acceptsStrategy(role: HostRole, strategy: string): boolean {
    // TODO: uncomment once connection providers are set up
    // if (role === HostRole.UNKNOWN) {
    //   // Users must request either a writer or a reader role.
    //   return false;
    // }
    //
    // if (this.effectiveConnProvider) {
    //   return this.effectiveConnProvider.acceptsStrategy(role, strategy);
    // }
    // return this.connProviderManager.acceptsStrategy(role, strategy);
    return super.acceptsStrategy(role, strategy);
  }

  override getHostInfoByStrategy(role: HostRole, strategy: string): HostInfo {
    // TODO: uncomment once connection providers are set up
    // if (role === HostRole.UNKNOWN) {
    //   throw new AwsWrapperError(Messages.get("DefaultConnectionPlugin.unknownRoleRequested"));
    // }
    //
    // const hosts = this.pluginService.getHosts();
    // if (hosts.length < 1) {
    //   throw new AwsWrapperError(Messages.get("DefaultConnectionPlugin.noHostsAvailable"));
    // }
    //
    // if (this.effectiveConnProvider) {
    //   return this.effectiveConnProvider.getHostInfoByStrategy(hosts, role, strategy, this.pluginService.props);
    // }
    return super.getHostInfoByStrategy(role, strategy);
  }
}
