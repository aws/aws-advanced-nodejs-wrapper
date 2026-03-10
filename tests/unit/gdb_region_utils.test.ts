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

import { GDBRegionUtils } from "../../common/lib/utils/gdb_region_utils";

describe("GDBRegionUtils", () => {
  let gdbRegionUtils: GDBRegionUtils;

  beforeEach(() => {
    gdbRegionUtils = new GDBRegionUtils();
  });

  describe("getRegionFromClusterArn", () => {
    it.each([
      ["arn:aws:rds:us-east-1:123456789012:cluster:my-cluster", "us-east-1"],
      ["arn:aws:rds:us-west-2:123456789012:cluster:my-cluster", "us-west-2"],
      ["arn:aws:rds:eu-west-1:123456789012:cluster:my-cluster", "eu-west-1"],
      ["arn:aws-us-gov:rds:us-gov-west-1:123456789012:cluster:my-cluster", "us-gov-west-1"],
      ["arn:aws-us-gov:rds:us-gov-east-1:123456789012:cluster:my-cluster", "us-gov-east-1"],
      ["arn:aws-cn:rds:cn-north-1:123456789012:cluster:my-cluster", "cn-north-1"],
      ["arn:aws-cn:rds:cn-northwest-1:123456789012:cluster:my-cluster", "cn-northwest-1"],
      ["arn:aws-iso:rds:us-iso-east-1:123456789012:cluster:my-cluster", "us-iso-east-1"],
      ["arn:aws-iso-b:rds:us-isob-east-1:123456789012:cluster:my-cluster", "us-isob-east-1"]
    ])("should extract region from partition-agnostic ARN: %s", (arn, expectedRegion) => {
      const region = gdbRegionUtils.getRegionFromClusterArn(arn);
      expect(region).toBe(expectedRegion);
    });

    it.each(["invalid-arn", "arn:aws:s3:::my-bucket", "arn:aws:rds", ""])("should return null for invalid ARN: %s", (invalidArn) => {
      const region = gdbRegionUtils.getRegionFromClusterArn(invalidArn);
      expect(region).toBeNull();
    });
  });
});
