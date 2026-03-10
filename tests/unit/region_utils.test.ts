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

import { RegionUtils } from "../../common/lib/utils/region_utils";

describe("RegionUtils", () => {
  let regionUtils: RegionUtils;

  beforeEach(() => {
    regionUtils = new RegionUtils();
  });

  describe("getRegion", () => {
    it("should return null when props is invalid", async () => {
      let result = await regionUtils.getRegion("region", undefined, undefined);
      expect(result).toBeNull();

      result = await regionUtils.getRegion("region", undefined, null);
      expect(result).toBeNull();

      const props = new Map<string, any>();
      result = await regionUtils.getRegion("region", undefined, props);
      expect(result).toBeNull();
    });

    it.each([
      ["undefinedRegionKey", undefined],
      ["nullRegionKey", null],
      ["emptyRegionKey", ""]
    ])("should return null when region key is invalid", async (regionKey: string, regionKeyVal: any) => {
      const props = new Map<string, any>();
      let result = await regionUtils.getRegion("region", undefined, props);
      expect(result).toBeNull();

      props.set(regionKey, regionKeyVal);
      result = await regionUtils.getRegion(regionKey, undefined, props);
      expect(result).toBeNull();
    });
  });

  describe("getRegionFromRegionString", () => {
    it.each([undefined, null, ""])("should return null for invalid regionString", (regionString: any) => {
      const result = regionUtils.getRegionFromRegionString(regionString);
      expect(result).toBeNull();
    });

    it("should return region for valid region string", () => {
      const result = regionUtils.getRegionFromRegionString("us-east-1");
      expect(result).toBe("us-east-1");
    });
  });
});
