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

import { HostAvailabilityStrategy } from "./host_availability_strategy";
import { WrapperProperties } from "../wrapper_property";
import { IllegalArgumentError } from "../utils/errors";
import { Messages } from "../utils/messages";
import { HostAvailability } from "./host_availability";

export class ExponentialBackoffHostAvailabilityStrategy implements HostAvailabilityStrategy {
  public static NAME = "exponentialBackoff";
  private readonly maxRetries: number = 5;
  private readonly initialBackoffTimeSec: number = 30;
  private notAvailableCount: number = 0;
  private lastChanged: number;

  constructor(props: Map<string, any>) {
    const retries = WrapperProperties.HOST_AVAILABILITY_STRATEGY_MAX_RETRIES.get(props);
    const backoffTimeSec = WrapperProperties.HOST_AVAILABILITY_STRATEGY_INITIAL_BACKOFF_TIME_SEC.get(props);

    if (retries < 1) {
      throw new IllegalArgumentError(Messages.get("HostAvailabilityStrategy.invalidMaxRetries", retries.toString()));
    }
    this.maxRetries = retries;

    if (backoffTimeSec < 1) {
      throw new IllegalArgumentError(Messages.get("HostAvailabilityStrategy.invalidInitialBackoffTime", backoffTimeSec.toString()));
    }

    this.initialBackoffTimeSec = backoffTimeSec;
    this.lastChanged = Date.now();
  }

  setHostAvailability(hostAvailability: HostAvailability): void {
    this.lastChanged = Date.now();
    if (hostAvailability === HostAvailability.AVAILABLE) {
      this.notAvailableCount = 0;
    } else {
      this.notAvailableCount++;
    }
  }

  getHostAvailability(rawHostAvailability: HostAvailability): HostAvailability {
    if (rawHostAvailability === HostAvailability.AVAILABLE) {
      return HostAvailability.AVAILABLE;
    }

    if (this.notAvailableCount >= this.maxRetries) {
      return HostAvailability.NOT_AVAILABLE;
    }

    const retryDelayMillis = Math.pow(2, this.notAvailableCount) * this.initialBackoffTimeSec * 1000;
    const earliestRetryMillis = this.lastChanged + retryDelayMillis;
    const nowMillis = Date.now();
    if (earliestRetryMillis < nowMillis) {
      return HostAvailability.AVAILABLE;
    }

    return rawHostAvailability;
  }
}
