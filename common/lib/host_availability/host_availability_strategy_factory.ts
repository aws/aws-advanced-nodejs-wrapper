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
import { SimpleHostAvailabilityStrategy } from "./simple_host_availability_strategy";
import { ExponentialBackoffHostAvailabilityStrategy } from "./exponential_backoff_host_availability_strategy";

export class HostAvailabilityStrategyFactory {
  public create(props: Map<string, any>): HostAvailabilityStrategy {
    if (!props || !WrapperProperties.DEFAULT_HOST_AVAILABILITY_STRATEGY.get(props)) {
      return new SimpleHostAvailabilityStrategy();
    } else if (
      ExponentialBackoffHostAvailabilityStrategy.NAME.toUpperCase() === WrapperProperties.DEFAULT_HOST_AVAILABILITY_STRATEGY.get(props).toUpperCase()
    ) {
      return new ExponentialBackoffHostAvailabilityStrategy(props);
    }
    return new SimpleHostAvailabilityStrategy();
  }
}
