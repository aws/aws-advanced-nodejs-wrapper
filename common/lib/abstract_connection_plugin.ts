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

import { ConnectionPlugin } from "./connection_plugin";
import { HostListProviderService } from "./host_list_provider_service";
import { HostInfo } from "./host_info";
import { HostChangeOptions } from "./host_change_options";
import { OldConnectionSuggestionAction } from "./old_connection_suggestion_action";
import { HostRole } from "./host_role";

export abstract class AbstractConnectionPlugin implements ConnectionPlugin {
  abstract getSubscribedMethods(): Set<string>;

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    return connectFunc();
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    return forceConnectFunc();
  }

  execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    return methodFunc();
  }

  initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    initHostProviderFunc();
  }

  notifyConnectionChanged(changes: Set<HostChangeOptions>): OldConnectionSuggestionAction {
    return OldConnectionSuggestionAction.NO_OPINION;
  }

  notifyHostListChanged(changes: Map<string, Set<HostChangeOptions>>): void {}

  acceptsStrategy(role: HostRole, strategy: string): boolean {
    return false;
  }

  getHostInfoByStrategy(role: HostRole, strategy: string): HostInfo | undefined {
    throw new Error("getHostInfoByStrategy is not supported by this plugin.");
  }
}
