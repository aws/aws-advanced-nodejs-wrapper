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

import { HostSelector } from "./host_selector";
import { HostInfo } from "./host_info";
import { HostRole } from "./host_role";
import { HostAvailability } from "./host_availability/host_availability";
import { AwsWrapperError } from "./utils/errors";
import { Messages } from "./utils/messages";

export class RandomHostSelector implements HostSelector {
  public static STRATEGY_NAME = "random";

  getHost(hosts: HostInfo[], role: HostRole, props?: Map<string, any>): HostInfo {
    const eligibleHosts = hosts.filter((hostInfo: HostInfo) => hostInfo.role === role && hostInfo.getAvailability() === HostAvailability.AVAILABLE);
    if (eligibleHosts.length === 0) {
      throw new AwsWrapperError(Messages.get("HostSelector.noHostsMatchingRole", role));
    }

    const randomIndex = Math.floor(Math.random() * eligibleHosts.length);
    return eligibleHosts[randomIndex];
  }
}
