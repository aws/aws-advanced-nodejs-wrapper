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
  private readonly cacheId: string;
  private cleanupTask: Promise<void> | null = null;
  private interruptCleanupTask: (() => void) | null = null;
  private isInitialized: boolean = false;
  private isClearing: boolean = false;

  constructor(
    cleanupIntervalNanos: bigint,
    shouldDisposeFunc?: (item: V) => boolean,
    asyncItemDisposalFunc?: (item: V) => Promise<void>,
    cacheId?: string
  ) {
    super(cleanupIntervalNanos, shouldDisposeFunc);
    this._asyncItemDisposalFunc = asyncItemDisposalFunc;
    this.cacheId = cacheId;
  }

  async clear(): Promise<void> {
    logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Starting clear() - isInitialized: ${this.isInitialized}, cache size: ${this.map.size}`);
    
    // Prevent multiple concurrent clear operations
    if (this.isClearing) {
      logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Clear already in progress, skipping`);
      return;
    }
    this.isClearing = true;
    
    try {
      if (this.isInitialized && this.cleanupTask) {
        this.isInitialized = false;
        logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Set isInitialized to false, interrupting cleanup task`);
        
        if (this.interruptCleanupTask) {
          this.interruptCleanupTask();
        }
        
        logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Waiting for cleanup task to complete`);
        try {
          await this.cleanupTask;
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Cleanup task completed successfully`);
        } catch (error) {
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Cleanup task completed with error: ${error.message}`);
        }
        
        this.cleanupTask = null;
        this.interruptCleanupTask = null;
        
        // Dispose all remaining items
        for (const [_, val] of this.map.entries()) {
          if (val !== undefined && this._asyncItemDisposalFunc !== undefined) {
            try {
              await this._asyncItemDisposalFunc(val.item);
            } catch (error) {
              logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Error disposing item: ${error.message}`);
            }
          }
        }
        logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - All items disposed`);
      }
      
      this.map.clear();
      logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Map cleared, final size: ${this.map.size}`);
      logger.debug(Messages.get("SlidingExpirationCacheWithCleanupTask.clear", this.cacheId));
    } finally {
      this.isClearing = false;
    }
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
    // Prevent multiple cleanup tasks from starting
    if (this.isInitialized || this.cleanupTask) {
      logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Cleanup task already initialized, skipping`);
      return;
    }
    
    this.isInitialized = true;
    logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Cleanup task started - isInitialized: ${this.isInitialized}`);
    logger.debug(Messages.get("SlidingExpirationCacheWithCleanupTask.cleanUpTaskInitialized", this.cacheId));
    
    try {
      while (this.isInitialized && !this.isClearing) {
        logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Cleanup loop iteration - isInitialized: ${this.isInitialized}, isClearing: ${this.isClearing}`);
        
        const [sleepPromise, abortSleepFunc] = sleepWithAbort(
          convertNanosToMs(this._cleanupIntervalNanos),
          Messages.get("SlidingExpirationCacheWithCleanupTask.cleanUpTaskInterrupted", this.cacheId)
        );
        this.interruptCleanupTask = abortSleepFunc;
        
        try {
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Starting sleep for ${convertNanosToMs(this._cleanupIntervalNanos)}ms`);
          await sleepPromise;
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Sleep completed normally`);
        } catch (error) {
          // Sleep has been interrupted, exit cleanup task.
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Sleep interrupted: ${error.message}`);
          logger.debug(error.message);
          break;
        }

        if (!this.isInitialized || this.isClearing) {
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Exiting cleanup loop - isInitialized: ${this.isInitialized}, isClearing: ${this.isClearing}`);
          break;
        }

        logger.debug(
          Messages.get("SlidingExpirationCacheWithCleanupTask.cleaningUp", convertNanosToMinutes(this._cleanupIntervalNanos).toString(), this.cacheId)
        );

        const itemsToRemove = [];
        for (const [key, val] of this.map.entries()) {
          if (val !== undefined && this._asyncItemDisposalFunc !== undefined && this.shouldCleanupItem(val)) {
            MapUtils.remove(this.map, key);
            itemsToRemove.push(this._asyncItemDisposalFunc(val.item));
          }
        }
        logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Disposing ${itemsToRemove.length} expired items`);
        try {
          await Promise.all(itemsToRemove);
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Successfully disposed ${itemsToRemove.length} items`);
        } catch (error) {
          logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Error disposing items: ${error.message}`);
          // Ignore.
        }
      }
    } finally {
      this.isInitialized = false;
      this.interruptCleanupTask = null;
      logger.debug(`[DEBUG-CLEANUP] ${this.cacheId} - Cleanup task loop ended - isInitialized: ${this.isInitialized}`);
      logger.debug(Messages.get("SlidingExpirationCacheWithCleanupTask.cleanUpTaskStopped", this.cacheId));
    }
  }
}
