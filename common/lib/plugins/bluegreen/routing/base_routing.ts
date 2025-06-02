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

import { PluginService } from "../../../plugin_service";
import { BlueGreenStatus } from "../blue_green_status";
import { convertMsToNanos, getTimeInNanos, sleep } from "../../../utils/utils";
import { BlueGreenRole } from "../blue_green_role";

export abstract class BaseRouting {
  protected static readonly SLEEP_CHUNK: number = 50;
  protected readonly hostAndPort: string;
  protected readonly role: BlueGreenRole;

  constructor(hostAndPort: string, role: BlueGreenRole) {
    this.hostAndPort = hostAndPort;
    this.role = role;
  }

  protected async delay(delayMs: number, bgStatus: BlueGreenStatus, pluginService: PluginService, bgdId: string): Promise<void> {
    const start: bigint = getTimeInNanos();
    const end = convertMsToNanos(delayMs);
    const minDelay: number = Math.min(delayMs, BaseRouting.SLEEP_CHUNK);

    if (!bgStatus) {
      await sleep(delayMs);
    } else {
      do {
        await sleep(minDelay);
      } while (bgStatus === pluginService.getStatus(BlueGreenStatus, bgdId) && getTimeInNanos() < end);
    }
  }

  toString(): string {
    return `${this.constructor.name} [${this.hostAndPort ?? "<null>"}, ${this.role.name ?? "<null>"}]`;
  }
}
