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

import { SimpleHostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/simple_host_availability_strategy";
import { HostInfoBuilder } from "aws-wrapper-common-lib/lib/host_info_builder";
import { HostInfo } from "aws-wrapper-common-lib/lib/host_info";
import { HostAvailability } from "aws-wrapper-common-lib/lib/host_availability/host_availability";
import { HostRole } from "aws-wrapper-common-lib/lib/host_role";
import { HostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/host_availability_strategy";

const defaultPort = HostInfo.NO_PORT;
const defaultHostAvailability = HostAvailability.AVAILABLE;
const defaultHostRole = HostRole.WRITER;
const defaultWeight = 100;
const hostUrl = "someHostUrl";

describe("testHostInfoBuilder", () => {
  let availabilityStrategy: HostAvailabilityStrategy;
  beforeEach(() => {
    availabilityStrategy = new SimpleHostAvailabilityStrategy();
  });

  it("testBuild", () => {
    const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy });
    const hostInfo = hostInfoBuilder.withHost(hostUrl).build();

    expect(hostInfo.host).toBe(hostUrl);
    expect(hostInfo.getHostAvailabilityStrategy()).toBe(availabilityStrategy);
    expect(hostInfo.port).toBe(defaultPort);
    expect(hostInfo.getAvailability()).toBe(defaultHostAvailability);
    expect(hostInfo.role).toBe(defaultHostRole);
    expect(hostInfo.weight).toBe(defaultWeight);
  });

  it("testBuildGivenPort", () => {
    const expectedPort = 555;

    const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy });
    const hostInfo = hostInfoBuilder.withHost(hostUrl).withPort(expectedPort).build();

    expect(hostInfo.host).toBe(hostUrl);
    expect(hostInfo.getHostAvailabilityStrategy()).toBe(availabilityStrategy);
    expect(hostInfo.port).toBe(expectedPort);
    expect(hostInfo.getAvailability()).toBe(defaultHostAvailability);
    expect(hostInfo.role).toBe(defaultHostRole);
    expect(hostInfo.weight).toBe(defaultWeight);
  });

  it("testBuildGivenAvailability", () => {
    const expectedAvailability = HostAvailability.NOT_AVAILABLE;

    const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy });
    const hostInfo = hostInfoBuilder.withHost(hostUrl).withAvailability(expectedAvailability).build();

    expect(hostInfo.host).toBe(hostUrl);
    expect(hostInfo.getHostAvailabilityStrategy()).toBe(availabilityStrategy);
    expect(hostInfo.port).toBe(defaultPort);
    expect(hostInfo.getAvailability()).toBe(expectedAvailability);
    expect(hostInfo.role).toBe(defaultHostRole);
    expect(hostInfo.weight).toBe(defaultWeight);
  });

  it("testBuildGivenRole", () => {
    const expectedRole = HostRole.READER;

    const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy });
    const hostInfo = hostInfoBuilder.withHost(hostUrl).withRole(expectedRole).build();

    expect(hostInfo.host).toBe(hostUrl);
    expect(hostInfo.getHostAvailabilityStrategy()).toBe(availabilityStrategy);
    expect(hostInfo.port).toBe(defaultPort);
    expect(hostInfo.getAvailability()).toBe(defaultHostAvailability);
    expect(hostInfo.role).toBe(expectedRole);
    expect(hostInfo.weight).toBe(defaultWeight);
  });

  it("testBuildGivenWeight", () => {
    const expectedWeight = 555;
    const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy });
    const hostInfo = hostInfoBuilder.withHost(hostUrl).withWeight(expectedWeight).build();

    expect(hostInfo.host).toBe(hostUrl);
    expect(hostInfo.getHostAvailabilityStrategy()).toBe(availabilityStrategy);
    expect(hostInfo.port).toBe(defaultPort);
    expect(hostInfo.getAvailability()).toBe(defaultHostAvailability);
    expect(hostInfo.role).toBe(defaultHostRole);
    expect(hostInfo.weight).toBe(expectedWeight);
  });

  it("testBuildGivenPortAvailabilityRoleAndWeight", () => {
    const expectedPort = 555;
    const expectedWeight = 777;
    const expectedAvailability = HostAvailability.NOT_AVAILABLE;
    const expectedRole = HostRole.READER;

    const hostInfoBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy });
    const hostInfo = hostInfoBuilder
      .withHost(hostUrl)
      .withPort(expectedPort)
      .withWeight(expectedWeight)
      .withAvailability(expectedAvailability)
      .withRole(expectedRole)
      .build();

    expect(hostInfo.host).toBe(hostUrl);
    expect(hostInfo.getHostAvailabilityStrategy()).toBe(availabilityStrategy);
    expect(hostInfo.port).toBe(expectedPort);
    expect(hostInfo.getAvailability()).toBe(expectedAvailability);
    expect(hostInfo.role).toBe(expectedRole);
    expect(hostInfo.weight).toBe(expectedWeight);
  });

  it("testCopyConstructorIsDeepCopy", () => {
    const hostInfoBuilderOriginal = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy })
      .withHost("someUrl")
      .withPort(1111)
      .withAvailability(HostAvailability.AVAILABLE)
      .withRole(HostRole.WRITER)
      .withWeight(111)
      .withLastUpdateTime(1);

    const hostInfoBuilderModifiedCopy = new HostInfoBuilder({ hostAvailabilityStrategy: availabilityStrategy })
      .withHost("someOtherUrl")
      .withPort(2222)
      .withAvailability(HostAvailability.NOT_AVAILABLE)
      .withRole(HostRole.READER)
      .withWeight(222)
      .withLastUpdateTime(2);

    const fromOriginalBuilder = hostInfoBuilderOriginal.build();
    const fromModifiedCopyBuilder = hostInfoBuilderModifiedCopy.build();

    expect(fromOriginalBuilder.host).not.toBe(fromModifiedCopyBuilder.host);
    expect(fromOriginalBuilder.port).not.toBe(fromModifiedCopyBuilder.port);
    expect(fromOriginalBuilder.getAvailability()).not.toBe(fromModifiedCopyBuilder.getAvailability());
    expect(fromOriginalBuilder.role).not.toBe(fromModifiedCopyBuilder.role);
    expect(fromOriginalBuilder.weight).not.toBe(fromModifiedCopyBuilder.weight);
    expect(fromOriginalBuilder.lastUpdateTime).not.toBe(fromModifiedCopyBuilder.lastUpdateTime);
    expect(fromOriginalBuilder.getHostAvailabilityStrategy()).toBe(fromModifiedCopyBuilder.getHostAvailabilityStrategy());
  });
});
