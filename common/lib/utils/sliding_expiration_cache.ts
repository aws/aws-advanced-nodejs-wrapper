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

import { getTimeInNanos } from "./utils";
import { MapUtils } from "./map_utils";

class CacheItem<V> {
  readonly item: V;
  private _expirationTimeNanos: bigint;

  constructor(item: V, expirationTimeNanos: bigint) {
    this.item = item;
    this._expirationTimeNanos = expirationTimeNanos;
  }

  get expirationTimeNs(): bigint {
    return this._expirationTimeNanos;
  }

  updateExpiration(expirationIntervalNanos: bigint): CacheItem<V> {
    this._expirationTimeNanos = getTimeInNanos() + expirationIntervalNanos;
    return this;
  }
}

export class SlidingExpirationCache<K, V> {
  private _cleanupIntervalNanos: bigint = BigInt(10 * 60_000_000_000); // 10 minutes
  private readonly _shouldDisposeFunc?: (item: V) => boolean;
  private readonly _itemDisposalFunc?: (item: V) => void;
  map: Map<K, CacheItem<V>> = new Map<K, CacheItem<V>>();
  private _cleanupTimeNanos: bigint;

  constructor(cleanupIntervalNanos: bigint, shouldDisposeFunc?: (item: V) => boolean, itemDisposalFunc?: (item: V) => void) {
    this._cleanupIntervalNanos = cleanupIntervalNanos;
    this._shouldDisposeFunc = shouldDisposeFunc;
    this._itemDisposalFunc = itemDisposalFunc;
    this._cleanupTimeNanos = getTimeInNanos() + this._cleanupIntervalNanos;
  }

  get size(): number {
    return this.map.size;
  }

  get entries() {
    return this.map.entries();
  }

  get keys() {
    return this.map.keys();
  }

  set cleanupIntervalNs(value: bigint) {
    this._cleanupIntervalNanos = value;
  }

  computeIfAbsent(key: K, mappingFunc: (key: K) => V, itemExpirationNanos: bigint): V | null {
    this.cleanUp();
    const cacheItem = MapUtils.computeIfAbsent(this.map, key, (k) => new CacheItem(mappingFunc(k), getTimeInNanos() + itemExpirationNanos));
    return cacheItem?.updateExpiration(itemExpirationNanos).item ?? null;
  }

  putIfAbsent(key: K, value: V, itemExpirationNanos: bigint): V | null {
    const cacheItem = MapUtils.putIfAbsent(this.map, key, new CacheItem(value, getTimeInNanos() + itemExpirationNanos));
    return cacheItem?.item ?? null;
  }

  get(key: K): V | undefined {
    this.cleanUp();
    const cacheItem = this.map.get(key);
    return cacheItem?.item ?? undefined;
  }

  remove(key: K): void {
    this.removeAndDispose(key);
    this.cleanUp();
  }

  removeAndDispose(key: K): void {
    const cacheItem = MapUtils.remove(this.map, key);
    if (cacheItem != null && this._itemDisposalFunc != null) {
      this._itemDisposalFunc(cacheItem.item);
    }
  }

  removeIfExpired(key: K): void {
    let item;
    MapUtils.computeIfPresent(this.map, key, (key, cacheItem) => {
      if (this.shouldCleanupItem(cacheItem)) {
        item = cacheItem.item;
        return null;
      }
      return cacheItem;
    });

    if (item != undefined && item != null && this._itemDisposalFunc != null) {
      this._itemDisposalFunc(item);
    }
  }

  shouldCleanupItem(cacheItem: CacheItem<V>): boolean {
    if (this._shouldDisposeFunc != null) {
      return getTimeInNanos() > cacheItem.expirationTimeNs && this._shouldDisposeFunc(cacheItem.item);
    }
    return getTimeInNanos() > cacheItem.expirationTimeNs;
  }

  clear(): void {
    for (const [key, val] of this.map.entries()) {
      if (val !== undefined && this._itemDisposalFunc !== undefined) {
        this._itemDisposalFunc(val.item);
      }
    }
    this.map.clear();
  }

  protected cleanUp() {
    const currentTime = getTimeInNanos();
    if (this._cleanupTimeNanos > currentTime) {
      return;
    }
    this._cleanupTimeNanos = currentTime + this._cleanupIntervalNanos;
    for (const k of this.map.keys()) {
      this.removeIfExpired(k);
    }
  }
}
