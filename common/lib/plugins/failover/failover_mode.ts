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
  STRICT_WRITER,
  STRICT_READER,
  READER_OR_WRITER,
  UNKNOWN
}

const nameToValue = new Map([
  ["strict-writer", FailoverMode.STRICT_WRITER],
  ["strict-reader", FailoverMode.STRICT_READER],
  ["reader-or-writer", FailoverMode.READER_OR_WRITER],
  ["unknown", FailoverMode.UNKNOWN]
]);

export function failoverModeFromValue(name: string): FailoverMode {
  return nameToValue.get(name.toLowerCase()) ?? FailoverMode.UNKNOWN;
}
