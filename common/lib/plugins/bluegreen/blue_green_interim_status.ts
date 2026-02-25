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
import { HostInfo } from "../../host_info";
import { logTopology } from "../../utils/utils";
import { getValueHash } from "./blue_green_utils";

export class BlueGreenInterimStatus {
  public blueGreenPhase: BlueGreenPhase;
  public version: string;
  public port: number;
  public startTopology: HostInfo[];
  public currentTopology: HostInfo[];
  public startIpAddressesByHostMap: Map<string, string | undefined>;
  public currentIpAddressesByHostMap: Map<string, string | undefined>;
  public hostNames: Set<string>; // all known host names; just host, no port
  public allStartTopologyIpChanged: boolean;
  public allStartTopologyEndpointsRemoved: boolean;
  public allTopologyChanged: boolean;

  constructor(
    blueGreenPhase: BlueGreenPhase,
    version: string,
    port: number,
    startTopology: HostInfo[],
    currentTopology: HostInfo[],
    startIpAddressesByHostMap: Map<string, string | undefined>,
    currentIpAddressesByHostMap: Map<string, string | undefined>,
    hostNames: Set<string>,
    allStartTopologyIpChanged: boolean,
    allStartTopologyEndpointsRemoved: boolean,
    allTopologyChanged: boolean
  ) {
    this.blueGreenPhase = blueGreenPhase;
    this.version = version;
    this.port = port;
    this.startTopology = startTopology;
    this.currentTopology = currentTopology;
    this.startIpAddressesByHostMap = startIpAddressesByHostMap;
    this.currentIpAddressesByHostMap = currentIpAddressesByHostMap;
    this.hostNames = hostNames;
    this.allStartTopologyIpChanged = allStartTopologyIpChanged;
    this.allStartTopologyEndpointsRemoved = allStartTopologyEndpointsRemoved;
    this.allTopologyChanged = allTopologyChanged;
  }

  public toString(): string {
    const currentIpMap = Array.from(this.currentIpAddressesByHostMap.entries())
      .map(([key, value]) => `${key} -> ${value}`)
      .join("\n\t");

    const startIpMap = Array.from(this.startIpAddressesByHostMap.entries())
      .map(([key, value]) => `${key} -> ${value}`)
      .join("\n\t");

    const allHostNamesStr = Array.from(this.hostNames).join("\n\t");
    const startTopologyStr = logTopology(this.startTopology, "");
    const currentTopologyStr = logTopology(this.currentTopology, "");

    return `${this.constructor.name} [
     phase: ${this.blueGreenPhase?.name ?? "<null>"}, 
     version: '${this.version}', 
     port: ${this.port}, 
     hostNames:
       ${!allHostNamesStr ? "-" : allHostNamesStr} 
     startTopology: ${!startTopologyStr ? "-" : startTopologyStr} 
     start IP map:
       ${!startIpMap ? "-" : startIpMap} 
     currentTopology: ${!currentTopologyStr ? "-" : currentTopologyStr} 
     current IP map:
       ${!currentIpMap ? "-" : currentIpMap} 
     allStartTopologyIpChanged: ${this.allStartTopologyIpChanged} 
     allStartTopologyEndpointsRemoved: ${this.allStartTopologyEndpointsRemoved} 
     allTopologyChanged: ${this.allTopologyChanged} 
    ]`;
  }

  getCustomHashCode(): bigint {
    let result: bigint = getValueHash(1n, this.blueGreenPhase?.name || "");
    result = getValueHash(result, this.version || "");
    result = getValueHash(result, this.port.toString());
    result = getValueHash(result, this.allStartTopologyIpChanged.toString());
    result = getValueHash(result, this.allStartTopologyEndpointsRemoved.toString());
    result = getValueHash(result, this.allTopologyChanged.toString());

    result = getValueHash(result, this.hostNames == null ? "" : Array.from(this.hostNames).sort().join(","));

    result = getValueHash(
      result,
      this.startTopology == null
        ? ""
        : this.startTopology
            .map((x) => x.hostAndPort + x.role)
            .sort()
            .join(",")
    );

    result = getValueHash(
      result,
      this.currentTopology == null
        ? ""
        : this.currentTopology
            .map((x) => x.hostAndPort + x.role)
            .sort()
            .join(",")
    );

    result = getValueHash(
      result,
      this.startIpAddressesByHostMap == null
        ? ""
        : Array.from(this.startIpAddressesByHostMap.entries())
            .map(([key, value]) => key + value)
            .sort()
            .join(",")
    );

    result = getValueHash(
      result,
      this.currentIpAddressesByHostMap == null
        ? ""
        : Array.from(this.currentIpAddressesByHostMap.entries())
            .map(([key, value]) => key + value)
            .sort()
            .join(",")
    );

    return result;
  }
}
