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

import { HostRole } from "aws-wrapper-common-lib/lib/host_role";
import { HostInfoBuilder } from "aws-wrapper-common-lib/lib/host_info_builder";
import { HostAvailability } from "aws-wrapper-common-lib/lib/host_availability/host_availability";
import { SimpleHostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/simple_host_availability_strategy";
import { RandomHostSelector } from "aws-wrapper-common-lib/lib/random_host_selector";

const unavailableHostName = "someUnavailableHost";
const availableHostName = "someAvailableHost";
const HOST_ROLE: HostRole = HostRole.READER;

describe("test random host selector", () => {
  it.each(Array(50).fill(null))("test get host given unavailable host", async () => {
    const unavailableHost = new HostInfoBuilder({
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    })
      .withHost(unavailableHostName)
      .withRole(HOST_ROLE)
      .withAvailability(HostAvailability.NOT_AVAILABLE)
      .build();

    const availableHost = new HostInfoBuilder({
      hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
    })
      .withHost(availableHostName)
      .withRole(HOST_ROLE)
      .withAvailability(HostAvailability.AVAILABLE)
      .build();

    const hostSelector = new RandomHostSelector();
    const actualHost = hostSelector.getHost([unavailableHost, availableHost], HOST_ROLE, new Map());

    expect(actualHost).toBe(availableHost);
  });

  it.each(Array(50).fill(null))("test get host given multiple unavailable hosts", async () => {
    const hostInfoTestsList = [
      new HostInfoBuilder({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
      })
        .withHost(unavailableHostName)
        .withRole(HOST_ROLE)
        .withAvailability(HostAvailability.NOT_AVAILABLE)
        .build(),
      new HostInfoBuilder({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
      })
        .withHost(unavailableHostName)
        .withRole(HOST_ROLE)
        .withAvailability(HostAvailability.NOT_AVAILABLE)
        .build(),
      new HostInfoBuilder({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
      })
        .withHost(availableHostName)
        .withRole(HOST_ROLE)
        .withAvailability(HostAvailability.AVAILABLE)
        .build(),
      new HostInfoBuilder({
        hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
      })
        .withHost(availableHostName)
        .withRole(HOST_ROLE)
        .withAvailability(HostAvailability.AVAILABLE)
        .build()
    ];

    const hostSelector = new RandomHostSelector();
    const actualHost = hostSelector.getHost(hostInfoTestsList, HOST_ROLE, new Map());

    expect(actualHost.getAvailability()).toBe(HostAvailability.AVAILABLE);
  });
});
