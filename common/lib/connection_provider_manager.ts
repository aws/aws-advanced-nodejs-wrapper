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

import { ConnectionProvider } from "./connection_provider";
import { HostRole } from "./host_role";
import { HostInfo } from "./host_info";
import { AwsWrapperError } from "./utils/errors";

export class ConnectionProviderManager {
  private static connProvider: ConnectionProvider | null = null;
  private readonly defaultProvider: ConnectionProvider;
  private readonly effectiveProvider: ConnectionProvider | null;

  constructor(defaultProvider: ConnectionProvider, effectiveProvider: ConnectionProvider | null) {
    this.defaultProvider = defaultProvider;
    this.effectiveProvider = effectiveProvider;
  }

  static setConnectionProvider(connProvider: ConnectionProvider) {
    ConnectionProviderManager.connProvider = connProvider;
  }

  getConnectionProvider(hostInfo: HostInfo | null, props: Map<string, any>) {
    if (hostInfo === null) {
      return this.defaultProvider;
    }

    if (ConnectionProviderManager.connProvider?.acceptsUrl(hostInfo, props)) {
      return ConnectionProviderManager.connProvider;
    }

    if (this.effectiveProvider && this.effectiveProvider.acceptsUrl(hostInfo, props)) {
      return this.effectiveProvider;
    }

    return this.defaultProvider;
  }

  acceptsStrategy(role: HostRole, strategy: string) {
    return (
      ConnectionProviderManager.connProvider?.acceptsStrategy(role, strategy) ||
      this.effectiveProvider?.acceptsStrategy(role, strategy) ||
      this.defaultProvider.acceptsStrategy(role, strategy)
    );
  }

  getHostInfoByStrategy(hosts: HostInfo[], role: HostRole, strategy: string, props: Map<string, any>) {
    let host;
    if (ConnectionProviderManager.connProvider?.acceptsStrategy(role, strategy)) {
      try {
        host = ConnectionProviderManager.connProvider.getHostInfoByStrategy(hosts, role, strategy, props);
      } catch (error) {
        if (error instanceof AwsWrapperError && error.message.includes("Unsupported host selection strategy")) {
          // Ignore and try with the default provider.
        } else {
          throw error;
        }
      }
    } else if (this.effectiveProvider?.acceptsStrategy(role, strategy)) {
      try {
        host = this.effectiveProvider.getHostInfoByStrategy(hosts, role, strategy, props);
      } catch (error) {
        if (error instanceof AwsWrapperError && error.message.includes("Unsupported host selection strategy")) {
          // Ignore and try with the default provider.
        } else {
          throw error;
        }
      }
    }

    if (!host) {
      host = this.defaultProvider.getHostInfoByStrategy(hosts, role, strategy, props);
    }

    return host;
  }

  static resetProvider() {
    this.connProvider = null;
  }
}
