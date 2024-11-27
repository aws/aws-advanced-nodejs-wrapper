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

export class ConfigurationProfilePresetCodes {
  public static readonly A0 = "A0"; // Normal
  public static readonly A1 = "A1"; // Easy
  public static readonly A2 = "A2"; // Aggressive
  public static readonly B = "B"; // Normal
  public static readonly C0 = "C0"; // Normal
  public static readonly C1 = "C1"; // Aggressive
  public static readonly D0 = "D0"; // Normal
  public static readonly D1 = "D1"; // Easy
  public static readonly E = "E"; // Normal
  public static readonly F0 = "F0"; // Normal
  public static readonly F1 = "F1"; // Aggressive
  public static readonly G0 = "G0"; // Normal
  public static readonly G1 = "G1"; // Easy
  public static readonly H = "H"; // Normal
  public static readonly I0 = "I0"; // Normal
  public static readonly I1 = "I1"; // Aggressive

  public static isKnownPreset(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(ConfigurationProfilePresetCodes, name);
  }
}
