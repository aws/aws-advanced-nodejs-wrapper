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

export enum GlobalDbFailoverMode {
  STRICT_WRITER = "strict-writer",
  STRICT_HOME_READER = "strict-home-reader",
  STRICT_OUT_OF_HOME_READER = "strict-out-of-home-reader",
  STRICT_ANY_READER = "strict-any-reader",
  HOME_READER_OR_WRITER = "home-reader-or-writer",
  OUT_OF_HOME_READER_OR_WRITER = "out-of-home-reader-or-writer",
  ANY_READER_OR_WRITER = "any-reader-or-writer",
  UNKNOWN = "unknown"
}

export function globalDbFailoverModeFromValue(value: string | null | undefined): GlobalDbFailoverMode {
  if (!value) {
    return GlobalDbFailoverMode.UNKNOWN;
  }
  const normalized = value.toLowerCase();
  return Object.values(GlobalDbFailoverMode).find((v) => v === normalized) ?? GlobalDbFailoverMode.UNKNOWN;
}
