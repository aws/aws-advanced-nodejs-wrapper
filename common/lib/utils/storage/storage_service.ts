/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Constructor, ItemDisposalFunc, ShouldDisposeFunc } from "../../types";
import { logger } from "../../../logutils";
import { ExpirationCache } from "./expiration_cache";
import { Topology } from "../../host_list_provider/topology";

const DEFAULT_CLEANUP_INTERVAL_NANOS = 5 * 60 * 1_000_000_000; // 5 minutes

/**
 * Interface for a storage service that manages items with expiration and disposal logic.
 * Extends StateSnapshotProvider for state management capabilities.
 */
export interface StorageService {
  /**
   * Registers a new item class with the storage service. This method needs to be called before adding new classes of
   * items to the service, so that the service knows when and how to dispose of the item. Expected item classes will be
   * added automatically during driver initialization, but this method can be called to add new classes of items.
   *
   * @param itemClass The constructor/class of the item that will be stored
   * @param isRenewableExpiration Controls whether the item's expiration should be renewed if the item is fetched,
   *                              regardless of whether it is already expired or not
   * @param timeToLiveNanos How long an item should be stored before being considered expired, in nanoseconds
   * @param shouldDisposeFunc A function defining whether an item should be disposed if expired. If null/undefined,
   *                          the item will always be disposed if expired
   * @param itemDisposalFunc A function defining how to dispose of an item when it is removed. If null/undefined,
   *                         the item will be removed without performing any additional operations
   */
  registerItemClassIfAbsent<V>(
    itemClass: Constructor<V>,
    isRenewableExpiration: boolean,
    timeToLiveNanos: bigint,
    shouldDisposeFunc?: ShouldDisposeFunc<V> | null,
    itemDisposalFunc?: ItemDisposalFunc<V> | null
  ): void;

  /**
   * Stores an item in the storage service under the given item class.
   *
   * @param key The key for the item, e.g., "custom-endpoint.cluster-custom-XYZ.us-east-2.rds.amazonaws.com:5432"
   * @param item The item to store
   */
  set<V>(key: unknown, item: V): void;

  /**
   * Gets an item stored in the storage service.
   *
   * @param itemClass The expected constructor/class of the item being retrieved
   * @param key The key for the item, e.g., "custom-endpoint.cluster-custom-XYZ.us-east-2.rds.amazonaws.com:5432"
   * @returns The item stored at the given key for the given item class, or null/undefined if not found
   */
  get<V>(itemClass: Constructor<V>, key?: unknown): V | null;

  /**
   * Indicates whether an item exists under the given item class and key.
   *
   * @param itemClass The constructor/class of the item
   * @param key The key for the item, e.g., "custom-endpoint.cluster-custom-XYZ.us-east-2.rds.amazonaws.com:5432"
   * @returns true if the item exists under the given item class and key, otherwise returns false
   */
  exists(itemClass: Constructor, key: unknown): boolean;

  /**
   * Removes an item stored under the given item class.
   *
   * @param itemClass The constructor/class of the item
   * @param key The key for the item, e.g., "custom-endpoint.cluster-custom-XYZ.us-east-2.rds.amazonaws.com:5432"
   */
  remove(itemClass: Constructor, key: unknown): void;

  /**
   * Clears all items of the given item class. For example, storageService.clear(AllowedAndBlockedHosts) will
   * remove all AllowedAndBlockedHost items from the storage service.
   *
   * @param itemClass The constructor/class of the items to clear
   */
  clear(itemClass: Constructor): void;

  /**
   * Clears all items from the storage service.
   */
  clearAll(): void;

  /**
   * Returns the number of items stored for the given item class.
   *
   * @param itemClass The constructor/class of the items to count
   * @returns The number of items stored for the given item class
   */
  size(itemClass: Constructor): number;
}

type CacheSupplier = () => ExpirationCache<unknown, unknown>;

export class StorageServiceImpl implements StorageService {
  private static readonly defaultCacheSuppliers: Map<Constructor, CacheSupplier> = new Map([[Topology, () => new ExpirationCache()]]);

  protected readonly caches: Map<Constructor, ExpirationCache<unknown, unknown>> = new Map();
  protected cleanupIntervalHandle?: NodeJS.Timeout;

  constructor(cleanupIntervalNanos: number = DEFAULT_CLEANUP_INTERVAL_NANOS) {
    this.initCleanupThread(cleanupIntervalNanos);
  }

  protected initCleanupThread(cleanupIntervalNanos: number): void {
    const intervalMs = cleanupIntervalNanos / 1_000_000;
    this.cleanupIntervalHandle = setInterval(() => {
      this.removeExpiredItems();
    }, intervalMs);

    // Allow Node.js to exit even if this timer is active
    if (this.cleanupIntervalHandle.unref) {
      this.cleanupIntervalHandle.unref();
    }
  }

  protected removeExpiredItems(): void {
    logger.debug("StorageServiceImpl: Removing expired items");
    for (const cache of this.caches.values()) {
      cache.removeExpiredEntries();
    }
  }

  registerItemClassIfAbsent<V>(
    itemClass: Constructor<V>,
    isRenewableExpiration: boolean,
    timeToLiveNanos: bigint,
    shouldDisposeFunc?: ShouldDisposeFunc<V> | null,
    itemDisposalFunc?: ItemDisposalFunc<V> | null
  ): void {
    if (!this.caches.has(itemClass)) {
      const cache = new ExpirationCache<unknown, unknown>(
        isRenewableExpiration,
        timeToLiveNanos,
        shouldDisposeFunc ?? undefined,
        itemDisposalFunc ?? undefined
      );
      this.caches.set(itemClass, cache);
    }
  }

  set<V>(key: unknown, item: V): void {
    const itemClass = item.constructor as Constructor<V>;
    let cache = this.caches.get(itemClass);

    if (!cache) {
      const supplier = StorageServiceImpl.defaultCacheSuppliers.get(itemClass);
      if (!supplier) {
        throw new Error(`StorageServiceImpl: Item class not registered: ${itemClass.name}`);
      }
      cache = supplier();
      this.caches.set(itemClass, cache);
    }

    try {
      cache.put(key, item);
    } catch (error) {
      throw new Error(`StorageServiceImpl: Unexpected value mismatch for ${itemClass.name}: ${error}`);
    }
  }

  getAll<V>(itemClass: Constructor<V>): ExpirationCache<unknown, unknown> | null {
    const cache = this.caches.get(itemClass);
    if (!cache) {
      return null;
    }
    return cache;
  }

  get<V>(itemClass: Constructor<V>, key?: unknown): V | null {
    const cache = this.caches.get(itemClass);
    if (!cache) {
      return null;
    }

    const value = cache.get(key);
    if (value === null || value === undefined) {
      return null;
    }

    if (value instanceof itemClass) {
      return value as V;
    }

    logger.debug(`StorageServiceImpl: Item class mismatch for key ${String(key)}: ` + `expected ${itemClass.name}, got ${value.constructor.name}`);
    return null;
  }

  exists(itemClass: Constructor, key: unknown): boolean {
    const cache = this.caches.get(itemClass);
    if (!cache) {
      return false;
    }
    return cache.exists(key);
  }

  remove(itemClass: Constructor, key: unknown): void {
    const cache = this.caches.get(itemClass);
    if (cache) {
      cache.remove(key);
    }
  }

  clear(itemClass: Constructor): void {
    const cache = this.caches.get(itemClass);
    if (cache) {
      cache.clear();
    }
  }

  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }

    this.caches.clear();
  }

  size(itemClass: Constructor): number {
    const cache = this.caches.get(itemClass);
    if (!cache) {
      return 0;
    }
    return cache.size();
  }

  /**
   * Registers a default cache supplier for a specific item class.
   * This allows automatic cache creation when items of this class are stored.
   */
  static registerDefaultCacheSupplier(itemClass: Constructor, supplier: CacheSupplier): void {
    StorageServiceImpl.defaultCacheSuppliers.set(itemClass, supplier);
  }

  /**
   * Cleanup method to stop the cleanup interval timer.
   * Should be called when the service is no longer needed.
   */
  destroy(): void {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = undefined;
    }
    this.clearAll();
  }
}
