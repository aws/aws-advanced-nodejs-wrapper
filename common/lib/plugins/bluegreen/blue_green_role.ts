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

import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";

export class BlueGreenRole {
  static readonly SOURCE = new BlueGreenRole("SOURCE", 0);
  static readonly TARGET = new BlueGreenRole("TARGET", 1);

  private static readonly blueGreenRoleMapping_1_0: Map<string, BlueGreenRole> = new Map<string, BlueGreenRole>()
    .set("BLUE_GREEN_DEPLOYMENT_SOURCE", BlueGreenRole.SOURCE)
    .set("BLUE_GREEN_DEPLOYMENT_TARGET", BlueGreenRole.TARGET);

  private readonly _name: string;
  private readonly _value: number;

  constructor(name: string, value: number) {
    this._name = name;
    this._value = value;
  }

  get name(): string {
    return this._name;
  }

  get value(): number {
    return this._value;
  }

  public static parseRole(value: string, version: string): BlueGreenRole {
    if (version === "1.0") {
      if (!value?.trim()) {
        throw new AwsWrapperError(Messages.get("bgd.unknownRole", value));
      }

      const role = BlueGreenRole.blueGreenRoleMapping_1_0.get(value.toUpperCase());

      if (role == null) {
        throw new AwsWrapperError(Messages.get("bgd.unknownRole", value));
      }

      return role;
    }

    throw new AwsWrapperError(Messages.get("bgd.unknownVersion", version));
  }
}
