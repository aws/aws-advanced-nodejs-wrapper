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

import { AccessibleRegions } from "../../common/lib/utils/accessible_regions";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";

const hostBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const hostIn = (host: string) => hostBuilder.withHost(host).build();

const usEast1 = hostIn("instance.cluster-abc.us-east-1.rds.amazonaws.com");
const usWest2 = hostIn("instance.cluster-xyz.us-west-2.rds.amazonaws.com");
const euWest1 = hostIn("instance.cluster-xyz.eu-west-1.rds.amazonaws.com");
const nonRds = hostIn("localhost");

describe("AccessibleRegions", () => {
  let props: Map<string, any>;

  beforeEach(() => {
    props = new Map<string, any>();
  });

  it.each([
    [undefined, "not set"],
    ["", "empty string"],
    ["   ", "whitespace only"],
    [",,", "only commas"]
  ])("returns null when property is %s (%s)", (value, _desc) => {
    if (value !== undefined) {
      props.set(WrapperProperties.GDB_ACCESSIBLE_REGIONS.name, value);
    }
    expect(AccessibleRegions.parse(props)).toBeNull();
  });

  it.each([
    ["us-east-1", ["us-east-1"], "single region"],
    ["us-east-1,us-west-2,eu-west-1", ["us-east-1", "us-west-2", "eu-west-1"], "multiple regions"],
    ["US-EAST-1,Us-West-2", ["us-east-1", "us-west-2"], "normalizes to lowercase"],
    [" us-east-1 , us-west-2 ", ["us-east-1", "us-west-2"], "trims whitespace"],
    ["us-east-1,,us-west-2,", ["us-east-1", "us-west-2"], "filters empty entries from trailing comma"]
  ])("parses '%s' → %j (%s)", (input, expected) => {
    props.set(WrapperProperties.GDB_ACCESSIBLE_REGIONS.name, input);
    expect(AccessibleRegions.parse(props)).toEqual(expected);
  });

  describe("isHostAccessible", () => {
    it.each<[string[] | null, string]>([
      [null, "null regions"],
      [[], "empty regions"]
    ])("returns true for every host when regions are %s (%s)", (regions) => {
      expect(AccessibleRegions.isHostAccessible(usEast1, regions)).toBe(true);
      expect(AccessibleRegions.isHostAccessible(nonRds, regions)).toBe(true);
    });

    it("returns true when the host region is in the accessible set", () => {
      expect(AccessibleRegions.isHostAccessible(usEast1, ["us-east-1", "us-west-2"])).toBe(true);
    });

    it("returns false when the host region is not in the accessible set", () => {
      expect(AccessibleRegions.isHostAccessible(euWest1, ["us-east-1", "us-west-2"])).toBe(false);
    });

    it("returns false when the host region cannot be determined", () => {
      expect(AccessibleRegions.isHostAccessible(nonRds, ["us-east-1"])).toBe(false);
    });
  });

  describe("filterHosts", () => {
    it.each<[string[] | null, string]>([
      [null, "null regions"],
      [[], "empty regions"]
    ])("returns the list unchanged when regions are %s (%s)", (regions) => {
      const hosts = [usEast1, usWest2, euWest1, nonRds];
      expect(AccessibleRegions.filterHosts(hosts, regions)).toEqual(hosts);
    });

    it("keeps only hosts whose region is accessible", () => {
      const hosts = [usEast1, usWest2, euWest1, nonRds];
      expect(AccessibleRegions.filterHosts(hosts, ["us-east-1", "us-west-2"])).toEqual([usEast1, usWest2]);
    });

    it("returns an empty list when no host is in an accessible region", () => {
      expect(AccessibleRegions.filterHosts([usEast1, usWest2], ["ap-southeast-1"])).toEqual([]);
    });
  });
});
