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

export class AllowedAndBlockedHosts {
  private readonly allowedHostIds: Set<string>;
  private readonly blockedHostIds: Set<string>;

  constructor(allowedHostIds: Set<string>, blockedHostIds: Set<string>) {
    this.allowedHostIds = allowedHostIds;
    this.blockedHostIds = blockedHostIds;
  }

  getAllowedHostIds() {
    return this.allowedHostIds;
  }

  getBlockedHostIds() {
    return this.blockedHostIds;
  }
}
