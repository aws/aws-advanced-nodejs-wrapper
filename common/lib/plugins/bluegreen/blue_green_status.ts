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

import { BlueGreenPhase } from "./blue_green_phase";
import { ConnectRouting } from "./routing/connect_routing";
import { ExecuteRouting } from "./routing/execute_routing";
import { BlueGreenRole } from "./blue_green_role";
import { HostInfo } from "../../host_info";
import { Pair } from "../../utils/utils";

export class BlueGreenStatus {
  private readonly bgdId: string;
  private readonly _currentPhase: BlueGreenPhase;
  private readonly _unmodifiableConnectRouting: readonly ConnectRouting[];
  private readonly _unmodifiableExecuteRouting: readonly ExecuteRouting[];

  private readonly _roleByHost: Map<string, BlueGreenRole>;
  private readonly _correspondingHosts: Map<string, Pair<HostInfo, HostInfo>>;

  constructor(
    bgdId: string,
    phase: BlueGreenPhase,
    unmodifiableConnectRouting?: ConnectRouting[],
    unmodifiableExecuteRouting?: ExecuteRouting[],
    roleByHost?: Map<string, BlueGreenRole>,
    correspondingHosts?: Map<string, Pair<HostInfo, HostInfo>>
  ) {
    this.bgdId = bgdId;
    this._currentPhase = phase;
    this._unmodifiableConnectRouting = Object.freeze(unmodifiableConnectRouting ?? []);
    this._unmodifiableExecuteRouting = Object.freeze(unmodifiableExecuteRouting ?? []);
    this._roleByHost = roleByHost ?? new Map();
    this._correspondingHosts = correspondingHosts ?? new Map();
  }

  get currentPhase(): BlueGreenPhase {
    return this._currentPhase;
  }

  get connectRouting(): readonly ConnectRouting[] {
    return this._unmodifiableConnectRouting;
  }

  get executeRouting(): readonly ExecuteRouting[] {
    return this._unmodifiableExecuteRouting;
  }

  get roleByHost(): Map<string, BlueGreenRole> {
    return this._roleByHost;
  }

  get correspondingHosts(): Map<string, Pair<HostInfo, HostInfo>> {
    return this._correspondingHosts;
  }

  getRole(hostInfo: HostInfo): BlueGreenRole {
    return this._roleByHost.get(hostInfo.host.toLowerCase());
  }

  toString(): string {
    const roleByHostMap = Array.from(this._roleByHost.entries())
      .map(([key, value]) => `${key} -> ${value.name}`)
      .join("\n   ");

    const connectRoutingStr = this._unmodifiableConnectRouting.map((x) => x.toString()).join("\n   ");

    const executeRoutingStr = this._unmodifiableExecuteRouting.map((x) => x.toString()).join("\n   ");

    return `${this.constructor.name} [
         bgdId: '${this.bgdId}',
         phase: ${this.currentPhase.name},
         Connect routing:
           ${connectRoutingStr ?? "-"}
         Execute routing:
           ${executeRoutingStr ?? "-"}
         roleByHost:
           ${roleByHostMap ?? "-"}
        ]`;
  }
}
