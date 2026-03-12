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

export enum FailoverMode {
  STRICT_WRITER = "strict-writer",
  STRICT_READER = "strict-reader",
  READER_OR_WRITER = "reader-or-writer",
  UNKNOWN = "unknown"
}

export function failoverModeFromValue(value: string | null | undefined): FailoverMode {
  if (!value) {
    return FailoverMode.UNKNOWN;
  }
  const normalized = value.toLowerCase();
  return Object.values(FailoverMode).find((v) => v === normalized) ?? FailoverMode.UNKNOWN;
}
