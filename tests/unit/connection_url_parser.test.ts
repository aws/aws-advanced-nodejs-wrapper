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

import { HostInfo } from "aws-wrapper-common-lib/lib/host_info";
import { HostInfoBuilder } from "aws-wrapper-common-lib/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "aws-wrapper-common-lib/lib/host_availability/simple_host_availability_strategy";
import { PgConnectionUrlParser } from "pg-wrapper/lib/pg_connection_url_parser";
import { describe, expect, it } from "@jest/globals";

describe("connectionUrlParserTest", () => {
  it.each([
    ["postgres://", []],
    [
      "somehost",
      [
        new HostInfoBuilder({
          port: -1,
          host: "somehost",
          hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
        }).build()
      ]
    ],
    [
      "postgres://host1:1234,host2:5678",
      [
        new HostInfoBuilder({
          port: 1234,
          host: "host1",
          hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
        }).build(),
        new HostInfoBuilder({
          port: 5678,
          host: "host2",
          hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
        }).build()
      ]
    ],
    [
      "postgres://host:1234/db?param=1",
      [
        new HostInfoBuilder({
          port: 1234,
          host: "host",
          hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy()
        }).build()
      ]
    ]
  ])("testGetHostsFromConnectionUrl_returnCorrectHostList", (testUrl: string, expected: HostInfo[]) => {
    const parser = new PgConnectionUrlParser();
    const results = parser.getHostsFromConnectionUrl(
      testUrl,
      false,
      () => new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() })
    );
    expect(results.length).toEqual(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(expected[i].equals(results[i])).toBeTruthy();
    }
  });
});
