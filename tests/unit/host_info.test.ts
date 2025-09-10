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

import { anything, instance, mock, verify } from "ts-mockito";
import { HostAvailability, HostAvailabilityStrategy, HostInfo, HostInfoBuilder } from "../../common/lib";

const mockStrategy = mock<HostAvailabilityStrategy>();
let hostInfo: HostInfo;

describe("hostInfoTests", () => {
  beforeEach(() => {
    hostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: instance(mockStrategy) }).withHost("someUrl").build();
  });

  it("testSetAvailabilityCallsHostAvailabilityStrategy", () => {
    const hostAvailability = HostAvailability.NOT_AVAILABLE;
    hostInfo.setAvailability(hostAvailability);
    verify(mockStrategy.setHostAvailability(anything())).once();
  });

  it("testGetAvailabilityCallsHostAvailabilityStrategy", () => {
    hostInfo.getAvailability();
    verify(mockStrategy.getHostAvailability(anything())).once();
  });
});
