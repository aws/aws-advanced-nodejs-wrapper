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

import { convertNanosToMinutes, convertNanosToMs, sleepWithAbort } from "./utils";
import { MapUtils } from "./map_utils";
import { SlidingExpirationCache } from "./sliding_expiration_cache";
import { Messages } from "./messages";
import { logger } from "../../logutils";

export class SlidingExpirationCacheWithCleanupTask<K, V> extends SlidingExpirationCache<K, V> {
  private readonly _asyncItemDisposalFunc?: (item: V) => Promise<void>;
  private stopCleanupTask: boolean = false;
  private cleanupTask: Promise<void>;
  private interruptCleanupTask: () => void;
  private isInitialized: boolean = false;

  constructor(cleanupIntervalNanos: bigint, shouldDisposeFunc?: (item: V) => boolean, asyncItemDisposalFunc?: (item: V) => Promise<void>) {
    super(cleanupIntervalNanos, shouldDisposeFunc);
    this._asyncItemDisposalFunc = asyncItemDisposalFunc;
  }

  async clear(): Promise<void> {
    this.stopCleanupTask = true;
    // If the cleanup task is currently sleeping this will interrupt it.
    this.interruptCleanupTask();
    await this.cleanupTask;

    for (const [key, val] of this.map.entries()) {
      if (val !== undefined && this._asyncItemDisposalFunc !== undefined) {
        await this._asyncItemDisposalFunc(val.item);
      }
    }
    this.map.clear();
  }

  computeIfAbsent(key: K, mappingFunc: (key: K) => V, itemExpirationNanos: bigint): V | null {
    if (!this.isInitialized) {
      this.cleanupTask = this.initCleanupTask();
    }
    return super.computeIfAbsent(key, mappingFunc, itemExpirationNanos);
  }

  putIfAbsent(key: K, value: V, itemExpirationNanos: bigint): V | null {
    if (!this.isInitialized) {
      this.cleanupTask = this.initCleanupTask();
    }
    return super.putIfAbsent(key, value, itemExpirationNanos);
  }

  put(key: K, value: V, itemExpirationNanos: bigint): V | null {
    if (!this.isInitialized) {
      this.cleanupTask = this.initCleanupTask();
    }
    return super.put(key, value, itemExpirationNanos);
  }

  protected cleanUp(): void {
    // Intentionally does nothing, cleanup task performs this job.
  }

  async initCleanupTask(): Promise<void> {
    this.isInitialized = true;
    while (!this.stopCleanupTask) {
      const [sleepPromise, temp] = sleepWithAbort(
        convertNanosToMs(this._cleanupIntervalNanos),
        Messages.get("SlidingExpirationCacheWithCleanupTask.cleanUpTaskInterrupted")
      );
      this.interruptCleanupTask = temp;
      try {
        await sleepPromise;
      } catch (error) {
        // Sleep has been interrupted, exit cleanup task.
        logger.info(error.message);
        return;
      }

      logger.info(Messages.get("SlidingExpirationCacheWithCleanupTask.cleaningUp", convertNanosToMinutes(this._cleanupIntervalNanos).toString()));

      const itemsToRemove = [];
      for (const [key, val] of this.map.entries()) {
        if (val !== undefined && this._asyncItemDisposalFunc !== undefined && this.shouldCleanupItem(val)) {
          MapUtils.remove(this.map, key);
          itemsToRemove.push(this._asyncItemDisposalFunc(val.item));
        }
      }
      try {
        await Promise.all(itemsToRemove);
      } catch (error) {
        // Ignore.
      }
    }
  }
}
