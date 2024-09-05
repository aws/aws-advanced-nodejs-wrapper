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

import { HostRole } from "./host_role";
import { HostAvailabilityStrategy } from "./host_availability/host_availability_strategy";
import { HostAvailability } from "./host_availability/host_availability";
import { SimpleHostAvailabilityStrategy } from "./host_availability/simple_host_availability_strategy";

export class HostInfo {
  public static readonly NO_PORT: number = -1;
  public static readonly DEFAULT_WEIGHT: number = 100;

  readonly host: string;
  readonly port: number;
  role: HostRole;
  readonly weight: number; // Greater or equal 0. Lesser the weight, the healthier node.
  readonly lastUpdateTime: number;
  availability: HostAvailability;
  aliases: Set<string> = new Set<string>();
  allAliases: Set<string> = new Set<string>();
  hostId?: string;
  hostAvailabilityStrategy: HostAvailabilityStrategy;

  constructor(
    host: string,
    port: number,
    role: HostRole = HostRole.UNKNOWN,
    availability: HostAvailability = HostAvailability.AVAILABLE,
    weight: number = HostInfo.DEFAULT_WEIGHT,
    lastUpdateTime: number = Date.now(),
    hostAvailabilityStrategy: HostAvailabilityStrategy = new SimpleHostAvailabilityStrategy()
  ) {
    this.host = host;
    this.port = port;
    this.availability = availability;
    this.role = role;
    this.weight = weight; // TODO: add check for weight parameter passed. As per comment above, weight should be Greater or equal 0
    this.lastUpdateTime = lastUpdateTime;
    this.hostAvailabilityStrategy = hostAvailabilityStrategy;
    this.allAliases.add(this.asAlias);
  }

  isPortSpecified(): boolean {
    return this.port != HostInfo.NO_PORT;
  }

  getHostAndPort(): string {
    return this.isPortSpecified() ? this.host + ":" + this.port : this.host;
  }

  addAlias(...alias: string[]) {
    if (!alias || alias.length < 1) {
      return;
    }

    alias.forEach((x) => {
      this.aliases.add(x);
      this.allAliases.add(x);
    });
  }

  removeAlias(aliases: string[]) {
    if (!aliases || aliases.length < 1) {
      return;
    }

    aliases.forEach((x) => {
      this.aliases.delete(x);
      this.allAliases.delete(x);
    });
  }

  resetAliases() {
    this.aliases.clear();
    this.allAliases.clear();
    this.allAliases.add(this.asAlias);
  }

  get asAlias() {
    return this.isPortSpecified() ? `${this.host}:${this.port}` : this.host;
  }

  get url() {
    let url = this.isPortSpecified() ? `${this.host}:${this.port}` : this.host;
    if (!url.endsWith("/")) {
      url += "/";
    }

    return url;
  }

  equals(other: HostInfo): boolean {
    return this.port === other.port && this.availability === other.availability && this.role === other.role && this.weight === other.weight;
  }

  getAvailability(): HostAvailability {
    if (this.hostAvailabilityStrategy) {
      return this.hostAvailabilityStrategy.getHostAvailability(this.availability);
    }

    return this.availability;
  }

  getRawAvailability(): HostAvailability {
    return this.availability;
  }

  setAvailability(availability: HostAvailability) {
    this.availability = availability;
    if (this.hostAvailabilityStrategy !== null) {
      this.hostAvailabilityStrategy.setHostAvailability(availability);
    }
  }

  getHostAvailabilityStrategy(): HostAvailabilityStrategy {
    return this.hostAvailabilityStrategy;
  }

  setHostAvailabilityStrategy(hostAvailabilityStrategy: HostAvailabilityStrategy): void {
    this.hostAvailabilityStrategy = hostAvailabilityStrategy;
  }

  toString(): string {
    return `HostInfo[host=${this.host}, port=${this.port}, ${this.role}, ${this.availability}, weight=${this.weight}, ${this.lastUpdateTime}]`;
  }
}
