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

export function getValueHash(currentHash: number, val: string): number {
  return currentHash * 31 + getHashCode(val);
}

export function getHashCode(str: string): number {
  let hash = 0;
  if (str.length === 0) {
    return hash;
  }

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = 31 * hash + char;
  }

  return hash;
}
