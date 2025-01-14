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

import { RdsUtils } from "./rds_utils";
import { AwsWrapperError } from "./errors";
import { Messages } from "./messages";

export class RegionUtils {
  static readonly REGIONS: string[] = [
    "af-south-1",
    "ap-east-1",
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-northeast-3",
    "ap-south-1",
    "ap-south-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-southeast-3",
    "ap-southeast-4",
    "ap-southeast-5",
    "aws-global",
    "aws-cn-global",
    "aws-us-gov-global",
    "aws-iso-global",
    "aws-iso-b-global",
    "ca-central-1",
    "ca-west-1",
    "cn-north-1",
    "cn-northwest-2",
    "eu-central-1",
    "eu-central-2",
    "eu-isoe-west-1",
    "eu-north-1",
    "eu-south-1",
    "eu-south-2",
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "il-central-1",
    "me-central-1",
    "me-south-1",
    "sa-east-1",
    "us-east-1",
    "us-east-2",
    "us-gov-east-1",
    "us-gov-west-1",
    "us-iso-east-1",
    "us-iso-west-1",
    "us-isob-east-1",
    "us-west-1",
    "us-west-2"
  ];

  protected static readonly rdsUtils = new RdsUtils();

  static getRegion(regionString: string, host?: string): string | null {
    const region = RegionUtils.getRegionFromRegionString(regionString);

    if (region !== null) {
      return region;
    }

    if (host) {
      return RegionUtils.getRegionFromHost(host);
    }

    return region;
  }

  private static getRegionFromRegionString(regionString: string): string {
    if (!regionString) {
      return null;
    }

    const region = regionString.toLowerCase().trim();
    if (!RegionUtils.REGIONS.includes(regionString)) {
      throw new AwsWrapperError(Messages.get("AwsSdk.unsupportedRegion", regionString));
    }

    return region;
  }

  private static getRegionFromHost(host: string): string | null {
    const regionString = RegionUtils.rdsUtils.getRdsRegion(host);
    if (!regionString) {
      throw new AwsWrapperError(Messages.get("AwsSdk.unsupportedRegion", regionString));
    }

    return RegionUtils.getRegionFromRegionString(regionString);
  }
}
