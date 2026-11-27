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

import { jest } from "@jest/globals";
import { AwsMySQLClient } from "../../mysql/lib/client";
import { AwsPgClient } from "../../pg/lib/client";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { HostRole } from "../../common/lib/host_role";

describe.each([AwsMySQLClient, AwsPgClient])("connection role verification: %p", (Client) => {
  it.each([undefined, "none"])("honors verifyOpenedConnectionType=%s", async (verification) => {
    const client = new Client({ plugins: "", verifyOpenedConnectionType: verification });
    const host = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() })
      .withHost("instance")
      .withRole(HostRole.WRITER)
      .build();
    const connection = { hostInfo: host };
    const getHostRole = jest.fn(async () => HostRole.READER);
    const setCurrentClient = jest.fn(async () => {});
    // Isolate the final role check from connection setup and physical I/O.
    Object.assign(client, {
      internalConnect: async () => {},
      internalPostConnect: async () => {},
      telemetryFactory: { openTelemetryContext: () => ({ start: async (fn: () => Promise<void>) => fn() }) },
      pluginManager: { connect: async () => connection },
      pluginService: {
        getCurrentHostInfo: () => host,
        getDialect: () => ({}),
        getHostRole,
        setCurrentHostInfo: () => {},
        setInitialConnectionHostInfo: () => {},
        getRoutedHostInfo: () => null,
        getInitialConnectionHostInfo: () => null,
        setRoutedHostInfo: () => {},
        setCurrentClient
      }
    });

    await client.connect();

    expect(getHostRole).toHaveBeenCalledTimes(verification === "none" ? 0 : 1);
    expect(host.role).toBe(verification === "none" ? HostRole.WRITER : HostRole.READER);
    expect(setCurrentClient).toHaveBeenCalledWith(connection, host);
  });
});
