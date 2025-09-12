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

import {
  ExponentialBackoffHostAvailabilityStrategy
} from "../../common/lib/host_availability/exponential_backoff_host_availability_strategy";
import { HostAvailability, IllegalArgumentError } from "../../common/lib";
import { sleep } from "../../common/lib/utils/utils";
import { WrapperProperties } from "../../common/lib/wrapper_property";

describe("exponentialBackoffTests", () => {
  let props: Map<string, any>;

  beforeEach(() => {
    props = new Map<string, any>();
  });

  it("testGetHostAvailabilityReturnsAvailable", async () => {
    const availabilityStrategy = new ExponentialBackoffHostAvailabilityStrategy(props);
    const actualHostAvailability = availabilityStrategy.getHostAvailability(HostAvailability.AVAILABLE);
    const expectedHostAvailability = HostAvailability.AVAILABLE;

    expect(actualHostAvailability).toBe(expectedHostAvailability);
  });

  it("testGetHostAvailabilityMaxRetriesExceeded", async () => {
    WrapperProperties.HOST_AVAILABILITY_STRATEGY_MAX_RETRIES.set(props, 1);
    WrapperProperties.HOST_AVAILABILITY_STRATEGY_INITIAL_BACKOFF_TIME_SEC.set(props, 3);

    const availabilityStrategy = new ExponentialBackoffHostAvailabilityStrategy(props);
    availabilityStrategy.setHostAvailability(HostAvailability.NOT_AVAILABLE);
    availabilityStrategy.setHostAvailability(HostAvailability.NOT_AVAILABLE);

    await sleep(3000);

    const actualHostAvailability = availabilityStrategy.getHostAvailability(HostAvailability.NOT_AVAILABLE);
    const expectedHostAvailability = HostAvailability.NOT_AVAILABLE;

    expect(actualHostAvailability).toBe(expectedHostAvailability);
  });

  it("testGetHostAvailabilityPastThreshold", async () => {
    WrapperProperties.HOST_AVAILABILITY_STRATEGY_INITIAL_BACKOFF_TIME_SEC.set(props, 3);
    const availabilityStrategy = new ExponentialBackoffHostAvailabilityStrategy(props);

    await sleep(3005);

    const actualHostAvailability = availabilityStrategy.getHostAvailability(HostAvailability.NOT_AVAILABLE);
    const expectedHostAvailability = HostAvailability.AVAILABLE;

    expect(actualHostAvailability).toBe(expectedHostAvailability);
  });

  it("testGetHostAvailabilityBeforeThreshold", async () => {
    WrapperProperties.HOST_AVAILABILITY_STRATEGY_INITIAL_BACKOFF_TIME_SEC.set(props, 3);
    const availabilityStrategy = new ExponentialBackoffHostAvailabilityStrategy(props);

    await sleep(2500);

    const actualHostAvailability = availabilityStrategy.getHostAvailability(HostAvailability.NOT_AVAILABLE);
    const expectedHostAvailability = HostAvailability.NOT_AVAILABLE;

    expect(actualHostAvailability).toBe(expectedHostAvailability);
  });

  it("testConstructorThrowsWhenInvalidMaxRetries", async () => {
    WrapperProperties.HOST_AVAILABILITY_STRATEGY_MAX_RETRIES.set(props, 0);
    expect(() => {
      new ExponentialBackoffHostAvailabilityStrategy(props);
    }).toThrow(IllegalArgumentError);
  });

  it("testConstructorThrowsWhenInvalidBackoffTime", async () => {
    WrapperProperties.HOST_AVAILABILITY_STRATEGY_INITIAL_BACKOFF_TIME_SEC.set(props, 0);
    expect(() => {
      new ExponentialBackoffHostAvailabilityStrategy(props);
    }).toThrow(IllegalArgumentError);
  });
});
