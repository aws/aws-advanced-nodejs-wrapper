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

import { HostInfoBuilder } from "../../common/lib";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { BlueGreenRole } from "../../common/lib/plugins/bluegreen/blue_green_role";
import { BlueGreenStatusMonitor } from "../../common/lib/plugins/bluegreen/blue_green_status_monitor";
import { SuspendConnectRouting } from "../../common/lib/plugins/bluegreen/routing/suspend_connect_routing";
import { SuspendExecuteRouting } from "../../common/lib/plugins/bluegreen/routing/suspend_execute_routing";

const clusterEndpoint = "my-cluster.cluster-abc123.us-east-1.rds.amazonaws.com";
const instanceEndpoint = "my-instance.abc123.us-east-1.rds.amazonaws.com";

function hostFor(host: string, port: number) {
  return new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() }).withHost(host).withPort(port).build();
}

describe("blue/green routing isMatch", () => {
  it("connect routing matches the same host and port", () => {
    const routing = new SuspendConnectRouting(`${clusterEndpoint}:3306`, BlueGreenRole.SOURCE, "bgd");
    expect(routing.isMatch(hostFor(clusterEndpoint, 3306), BlueGreenRole.SOURCE)).toBe(true);
  });

  it("connect routing does not match a different host", () => {
    const routing = new SuspendConnectRouting(`${clusterEndpoint}:3306`, BlueGreenRole.SOURCE, "bgd");
    expect(routing.isMatch(hostFor(instanceEndpoint, 3306), BlueGreenRole.SOURCE)).toBe(false);
  });

  it("connect routing with null host matches any host for the role", () => {
    const routing = new SuspendConnectRouting(null, BlueGreenRole.SOURCE, "bgd");
    expect(routing.isMatch(hostFor(instanceEndpoint, 3306), BlueGreenRole.SOURCE)).toBe(true);
    expect(routing.isMatch(hostFor(instanceEndpoint, 3306), BlueGreenRole.TARGET)).toBe(false);
  });

  it("execute routing matches the same host and port", () => {
    const routing = new SuspendExecuteRouting(`${clusterEndpoint}:3306`, BlueGreenRole.SOURCE, "bgd");
    expect(routing.isMatch(hostFor(clusterEndpoint, 3306), BlueGreenRole.SOURCE)).toBe(true);
  });

  it("execute routing does not match a different host", () => {
    const routing = new SuspendExecuteRouting(`${clusterEndpoint}:3306`, BlueGreenRole.SOURCE, "bgd");
    expect(routing.isMatch(hostFor(instanceEndpoint, 3306), BlueGreenRole.SOURCE)).toBe(false);
  });
});

describe("blue/green status monitor collectTopology", () => {
  it("keeps cluster endpoints already collected from the status table", async () => {
    const monitor: any = Object.create(BlueGreenStatusMonitor.prototype);
    monitor.hostListProvider = { forceRefresh: async () => [hostFor(instanceEndpoint, 3306)] };
    monitor.collectedTopology = true;
    monitor.startTopology = [];
    monitor.currentTopology = [];
    monitor.hostNames = new Set<string>([clusterEndpoint]);

    await monitor.collectTopology();

    expect(monitor.hostNames.has(clusterEndpoint)).toBe(true);
    expect(monitor.hostNames.has(instanceEndpoint)).toBe(true);
  });
});
