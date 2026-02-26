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

export class CacheItem<V> {
  private readonly item: V;
  private _expirationTimeNs: bigint;

  constructor(item: V, expirationTime: bigint) {
    this.item = item;
    this._expirationTimeNs = expirationTime;
  }

  isExpired(): boolean {
    if (this._expirationTimeNs <= 0) {
      // No expiration time.
      return false;
    }
    return getTimeInNanos() > this._expirationTimeNs;
  }

  get(returnExpired: boolean = false): V | null {
    return this.isExpired() && !returnExpired ? null : this.item;
  }

  updateExpiration(expirationIntervalNanos: bigint): CacheItem<V> {
    this._expirationTimeNs = getTimeInNanos() + expirationIntervalNanos;
    return this;
  }

  get expirationTimeNs(): bigint {
    return this._expirationTimeNs;
  }

  toString(): string {
    return `CacheItem [item=${this.item}, expirationTime=${this._expirationTimeNs}]`;
  }
}

export class CacheMap<K, V> {
  protected cache: Map<K, CacheItem<V>> = new Map<K, CacheItem<V>>();
  protected cleanupIntervalNanos: bigint = BigInt(10 * 60 * 1_000_000_000); // 10 minutes
  protected cleanupTimeNanos: bigint = process.hrtime.bigint() + this.cleanupIntervalNanos;

  get(key: K): V | null;
  get(key: K, defaultItemValue: V, itemExpirationNano: number): V | null;
  get(key: K, defaultItemValue?: any, itemExpirationNano?: any): V | null {
    const cacheItem: CacheItem<V> | undefined = this.cache.get(key);
    if (cacheItem && !cacheItem.isExpired()) {
      return cacheItem.get();
    }

    if (!defaultItemValue || !itemExpirationNano) {
      return null;
    }

    this.cache.set(key, new CacheItem(defaultItemValue, process.hrtime.bigint() + itemExpirationNano));
    return defaultItemValue;
  }

  put(key: K, item: V, itemExpirationNanos: number) {
    this.cache.set(key, new CacheItem(item, process.hrtime.bigint() + BigInt(itemExpirationNanos)));
    this.cleanUp();
  }

  putIfAbsent(key: K, item: V, itemExpirationNanos: number) {
    if (this.get(key) == null) {
      this.cache.set(key, new CacheItem(item, process.hrtime.bigint() + BigInt(itemExpirationNanos)));
    }
    this.cleanUp();
  }

  delete(key: K) {
    this.cache.delete(key);
    this.cleanUp();
  }

  size() {
    return this.cache.size;
  }

  clear() {
    this.cache.clear();
  }

  protected cleanUp() {
    if (this.cleanupTimeNanos < process.hrtime.bigint()) {
      this.cleanupTimeNanos = process.hrtime.bigint() + this.cleanupIntervalNanos;
      this.cache.forEach((v, k) => {
        if (!v || v.isExpired()) {
          this.cache.delete(k);
          // TODO: verify if we need to clean up any resources here.
        }
      });
    }
  }
}
