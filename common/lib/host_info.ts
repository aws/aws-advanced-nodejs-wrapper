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

  private readonly _host: string;
  private readonly _port: number;
  private _availability: HostAvailability;
  private readonly _role: HostRole;
  protected aliases: Set<string> = new Set<string>();
  private _allAliases: Set<string> = new Set<string>();
  private readonly _weight: number; // Greater or equal 0. Lesser the weight, the healthier node.
  private _hostId?: string;
  private readonly _lastUpdateTime: number;
  private _hostAvailabilityStrategy: HostAvailabilityStrategy;

  constructor(
    host: string,
    port: number,
    role: HostRole = HostRole.WRITER,
    availability: HostAvailability = HostAvailability.AVAILABLE,
    weight: number = HostInfo.DEFAULT_WEIGHT,
    lastUpdateTime: number = Date.now(),
    hostAvailabilityStrategy: HostAvailabilityStrategy = new SimpleHostAvailabilityStrategy()
  ) {
    this._host = host;
    this._port = port;
    this._availability = availability;
    this._role = role;
    this._weight = weight;
    this._lastUpdateTime = lastUpdateTime;
    this._hostAvailabilityStrategy = hostAvailabilityStrategy;
  }

  get host(): string {
    return this._host;
  }

  get port(): number {
    return this._port;
  }

  get hostId(): string | undefined {
    return this._hostId;
  }

  set hostId(id: string | undefined) {
    this._hostId = id;
  }

  isPortSpecified(): boolean {
    return this._port != HostInfo.NO_PORT;
  }

  addAlias(...alias: string[]) {
    if (!alias || alias.length < 1) {
      return;
    }

    alias.forEach((x) => {
      this.aliases.add(x);
      this._allAliases.add(x);
    });
  }

  removeAlias(...alias: string[]) {
    if (!alias || alias.length < 1) {
      return;
    }

    alias.forEach((x) => {
      this.aliases.delete(x);
      this._allAliases.delete(x);
    });
  }

  resetAliases() {
    this.aliases.clear();
    this.allAliases.clear();
    this.allAliases.add(this.asAlias);
  }

  get asAlias() {
    return this.isPortSpecified() ? `${this._host}:${this.port}` : this.host;
  }

  get url() {
    let url = this.isPortSpecified() ? `${this._host}:${this.port}` : this.host;
    if (!url.endsWith("/")) {
      url += "/";
    }

    return url;
  }

  get availability(): HostAvailability {
    return this._availability;
  }

  set availability(availability: HostAvailability) {
    this._availability = availability;
  }

  set hostAvailabilityStrategy(value: HostAvailabilityStrategy) {
    this._hostAvailabilityStrategy = value;
  }

  get role(): HostRole {
    return this._role;
  }

  get allAliases(): Set<string> {
    return this._allAliases;
  }

  get weight(): number {
    return this._weight;
  }

  get lastUpdateTime(): number {
    return this._lastUpdateTime;
  }

  get hostAvailabilityStrategy(): HostAvailabilityStrategy {
    return this._hostAvailabilityStrategy;
  }

  equals(other: HostInfo): boolean {
    return this.port === other.port && this.availability === other.availability && this.role === other.role && this.weight === other.weight;
  }

  getAvailability() {}

  setAvailability(availability: HostAvailability) {}

  toString(): string {
    return `HostInfo[host=${this.host}, port=${this.port}, ${this.role}, ${this.availability}, weight=${this.weight}, ${this.lastUpdateTime}]`;
  }
}
