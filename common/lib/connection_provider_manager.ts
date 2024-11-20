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

export class ConnectionProviderManager {
  private readonly connProvider: ConnectionProvider | null = null;
  private readonly defaultProvider: ConnectionProvider;
  private readonly effectiveProvider: ConnectionProvider | null;

  constructor(defaultProvider: ConnectionProvider, effectiveProvider: ConnectionProvider | null, connProvider?: ConnectionProvider) {
    this.defaultProvider = defaultProvider;
    this.effectiveProvider = effectiveProvider;
    this.connProvider = connProvider;
  }

  getConnectionProvider(hostInfo: HostInfo | null, props: Map<string, any>): ConnectionProvider {
    if (hostInfo === null) {
      return this.defaultProvider;
    }

    if (this.connProvider?.acceptsUrl(hostInfo, props)) {
      return this.connProvider;
    }

    if (this.effectiveProvider && this.effectiveProvider.acceptsUrl(hostInfo, props)) {
      return this.effectiveProvider;
    }

    return this.defaultProvider;
  }

  acceptsStrategy(role: HostRole, strategy: string) {
    return (
      this.connProvider?.acceptsStrategy(role, strategy) ||
      this.effectiveProvider?.acceptsStrategy(role, strategy) ||
      this.defaultProvider.acceptsStrategy(role, strategy)
    );
  }

  getHostInfoByStrategy(hosts: HostInfo[], role: HostRole, strategy: string, props: Map<string, any>) {
    let host;
    if (this.connProvider?.acceptsStrategy(role, strategy)) {
      try {
        host = this.connProvider.getHostInfoByStrategy(hosts, role, strategy, props);
      } catch {
        // Ignore and try with other providers.
      }
    }

    if (this.effectiveProvider?.acceptsStrategy(role, strategy)) {
      try {
        host = this.effectiveProvider.getHostInfoByStrategy(hosts, role, strategy, props);
      } catch {
        // Ignore and try with the default provider.
      }
    }

    if (!host) {
      host = this.defaultProvider.getHostInfoByStrategy(hosts, role, strategy, props);
    }

    return host;
  }
}
