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
});
