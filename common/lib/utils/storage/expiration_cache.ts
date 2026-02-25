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

import { getTimeInNanos } from "../utils";
import { ItemDisposalFunc, ShouldDisposeFunc } from "../../types";

export class CacheEntry<V> {
  readonly value: V;
  private _expirationTimeNanos: bigint;

  constructor(value: V, expirationTimeNanos: bigint) {
    this.value = value;
    this._expirationTimeNanos = expirationTimeNanos;
  }

  get expirationTimeNanos(): bigint {
    return this._expirationTimeNanos;
  }

  renewExpiration(timeToLiveNanos: bigint): void {
    this._expirationTimeNanos = getTimeInNanos() + timeToLiveNanos;
  }

  isExpired(): boolean {
    return getTimeInNanos() > this._expirationTimeNanos;
  }
}

export class ExpirationCache<K, V> {
  private readonly map: Map<K, CacheEntry<V>> = new Map();
  private readonly isRenewableExpiration: boolean;
  private readonly timeToLiveNanos: bigint;
  private readonly shouldDisposeFunc?: ShouldDisposeFunc<V> | null;
  private readonly itemDisposalFunc?: ItemDisposalFunc<V> | null;

  constructor(
    isRenewableExpiration: boolean = true,
    timeToLiveNanos: bigint = BigInt(300_000_000_000), // 5 minutes default
    shouldDisposeFunc?: ShouldDisposeFunc<V> | null,
    itemDisposalFunc?: ItemDisposalFunc<V> | null
  ) {
    this.isRenewableExpiration = isRenewableExpiration;
    this.timeToLiveNanos = timeToLiveNanos;
    this.shouldDisposeFunc = shouldDisposeFunc;
    this.itemDisposalFunc = itemDisposalFunc;
  }

  put(key: K, value: V): void {
    const expirationTime = getTimeInNanos() + this.timeToLiveNanos;
    this.map.set(key, new CacheEntry(value, expirationTime));
  }

  get(key: K): V | null | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return null;
    }

    if (entry.isExpired()) {
      if (this.shouldDispose(entry.value)) {
        this.removeEntry(key, entry);
        return null;
      }
    }

    if (this.isRenewableExpiration) {
      entry.renewExpiration(this.timeToLiveNanos);
    }

    return entry.value;
  }

  exists(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }

    if (entry.isExpired() && this.shouldDispose(entry.value)) {
      this.removeEntry(key, entry);
      return false;
    }

    return true;
  }

  remove(key: K): void {
    const entry = this.map.get(key);
    if (entry) {
      this.removeEntry(key, entry);
    }
  }

  clear(): void {
    for (const entry of this.map.values()) {
      this.disposeItem(entry.value);
    }
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  getEntries(): Map<K, V> {
    const result = new Map<K, V>();
    for (const [key, entry] of this.map.entries()) {
      result.set(key, entry.value);
    }
    return result;
  }

  removeExpiredEntries(): void {
    const keysToRemove: K[] = [];

    for (const [key, entry] of this.map.entries()) {
      if (entry.isExpired() && this.shouldDispose(entry.value)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      const entry = this.map.get(key);
      if (entry) {
        this.removeEntry(key, entry);
      }
    }
  }

  private shouldDispose(value: V): boolean {
    if (this.shouldDisposeFunc) {
      return this.shouldDisposeFunc(value);
    }
    return true;
  }

  private removeEntry(key: K, entry: CacheEntry<V>): void {
    this.map.delete(key);
    this.disposeItem(entry.value);
  }

  private disposeItem(value: V): void {
    if (this.itemDisposalFunc) {
      this.itemDisposalFunc(value);
    }
  }
}
