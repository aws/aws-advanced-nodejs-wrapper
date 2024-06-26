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

import { HostAvailabilityStrategyFactory } from "aws-wrapper-common-lib/lib/host_availability/host_availability_strategy_factory";
import { SimpleHostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/simple_host_availability_strategy";
import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";
import { ExponentialBackoffHostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/exponential_backoff_host_availability_strategy";

describe("hostAvailabilityStrategyFactoryTests", () => {
  it("testCreateDefaultAvailabilityStrategyGivenEmptyProperties", () => {
    const factory = new HostAvailabilityStrategyFactory();
    const availabilityStrategy = factory.create(new Map<string, any>());
    expect(availabilityStrategy).toBeInstanceOf(SimpleHostAvailabilityStrategy);
  });

  it("testCreateDefaultAvailabilityStrategyGivenOverrideProperty", () => {
    const props = new Map<string, any>();
    WrapperProperties.DEFAULT_HOST_AVAILABILITY_STRATEGY.set(props, ExponentialBackoffHostAvailabilityStrategy.NAME);
    const factory = new HostAvailabilityStrategyFactory();
    const availabilityStrategy = factory.create(props);
    expect(availabilityStrategy).toBeInstanceOf(ExponentialBackoffHostAvailabilityStrategy);
  });
});
