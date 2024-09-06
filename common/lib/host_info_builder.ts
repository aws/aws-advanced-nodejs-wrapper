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
import { HostAvailability } from "./host_availability/host_availability";
import { HostInfo } from "./host_info";
import { HostAvailabilityStrategy } from "./host_availability/host_availability_strategy";
import { AwsWrapperError } from "./utils/errors";

export class HostInfoBuilder {
  private host: string;
  private hostId: string;
  private port: number;
  private availability: HostAvailability;
  private role: HostRole;
  private weight: number; // Greater than or equal to 0. Healthier nodes have lower weights.
  private lastUpdateTime: number;
  private hostAvailabilityStrategy: HostAvailabilityStrategy;

  constructor(builder: {
    port?: number;
    host?: string;
    hostId?: string;
    hostAvailabilityStrategy: HostAvailabilityStrategy;
    availability?: HostAvailability;
    role?: HostRole;
    weight?: number;
    lastUpdateTime?: number;
  }) {
    this.host = builder.host ?? "";
    this.hostId = builder.hostId ?? "";
    this.port = builder.port ?? HostInfo.NO_PORT;
    this.availability = builder.availability ?? HostAvailability.AVAILABLE;
    this.role = builder.role ?? HostRole.WRITER;
    this.weight = builder.weight ?? HostInfo.DEFAULT_WEIGHT;
    this.lastUpdateTime = builder.lastUpdateTime ?? Date.now();
    this.hostAvailabilityStrategy = builder.hostAvailabilityStrategy;
  }

  withHost(host: string): HostInfoBuilder {
    this.host = host;
    return this;
  }

  withHostId(hostId: string): HostInfoBuilder {
    this.hostId = hostId;
    return this;
  }

  withPort(port: number): HostInfoBuilder {
    this.port = port;
    return this;
  }

  withAvailability(availability: HostAvailability): HostInfoBuilder {
    this.availability = availability;
    return this;
  }

  withRole(role: HostRole): HostInfoBuilder {
    this.role = role;
    return this;
  }

  withWeight(weight: number): HostInfoBuilder {
    this.weight = weight;
    return this;
  }

  withHostAvailabilityStrategy(hostAvailabilityStrategy: HostAvailabilityStrategy): HostInfoBuilder {
    this.hostAvailabilityStrategy = hostAvailabilityStrategy;
    return this;
  }

  withLastUpdateTime(lastUpdateTime: number): HostInfoBuilder {
    this.lastUpdateTime = lastUpdateTime;
    return this;
  }

  copyFrom(hostInfo: HostInfo): HostInfoBuilder {
    this.host = hostInfo.host;
    this.hostId = hostInfo.hostId ?? "";
    this.port = hostInfo.port;
    this.availability = hostInfo.availability;
    this.role = hostInfo.role;
    this.weight = hostInfo.weight;
    this.lastUpdateTime = hostInfo.lastUpdateTime;
    this.hostAvailabilityStrategy = hostInfo.hostAvailabilityStrategy;
    return this;
  }

  build() {
    if (!this.host) {
      throw new AwsWrapperError("host parameter must be set");
    }
    const hostInfo = new HostInfo(
      this.host,
      this.port,
      this.role,
      this.availability,
      this.weight,
      this.lastUpdateTime,
      this.hostAvailabilityStrategy
    );
    hostInfo.hostId = this.hostId;
    return hostInfo;
  }
}
