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

import { Event } from "./event";

/**
 * A class defining a data access event. The class specifies the class of the data
 * that was accessed and the key for the data.
 *
 * Used by StorageService to notify MonitorService when data is accessed,
 * allowing monitors to extend their expiration time.
 */
export class DataAccessEvent implements Event {
  readonly isImmediateDelivery = false;
  readonly dataClass: new (...args: any[]) => any;
  readonly key: unknown;

  constructor(dataClass: new (...args: any[]) => any, key: unknown) {
    this.dataClass = dataClass;
    this.key = key;
  }
}
