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

import { WrapperProperties } from "../wrapper_property";

export class AccessibleRegions {
  static parse(props: Map<string, any>): string[] | null {
    const value = WrapperProperties.GDB_ACCESSIBLE_REGIONS.get(props);
    if (!value || value.trim().length === 0) {
      return null;
    }

    const regions = value
      .split(",")
      .map((r: string) => r.trim().toLowerCase())
      .filter((r: string) => r.length > 0);

    return regions.length > 0 ? regions : null;
  }
}
