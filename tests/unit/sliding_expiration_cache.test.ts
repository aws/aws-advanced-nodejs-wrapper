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

import { SlidingExpirationCache } from "../../common/lib/utils/sliding_expiration_cache";
import { convertMsToNanos, convertNanosToMs, sleep } from "../../common/lib/utils/utils";
import { SlidingExpirationCacheWithCleanupTask } from "../../common/lib/utils/sliding_expiration_cache_with_cleanup_task";

class DisposableItem {
  shouldDispose: boolean;
  disposed: boolean;
  constructor(shouldDispose: boolean) {
    this.shouldDispose = shouldDispose;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }
}

class AsyncDisposableItem {
  shouldDispose: boolean;
  disposed: boolean;
  constructor(shouldDispose: boolean) {
    this.shouldDispose = shouldDispose;
    this.disposed = false;
  }

  async dispose(disposalTimeMs: number): Promise<void> {
    await sleep(disposalTimeMs);
    this.disposed = true;
  }
}

describe("test_sliding_expiration_cache", () => {
  it("test compute if absent", async () => {
    const target = new SlidingExpirationCache(BigInt(50_000_000));
    const result1 = target.computeIfAbsent(1, () => "a", convertMsToNanos(100));
    const originalItemExpiration = target.map.get(1)!.expirationTimeNs;
    const result2 = target.computeIfAbsent(1, () => "b", convertMsToNanos(500));
    const updatedItemExpiration = target.map.get(1)?.expirationTimeNs;

    expect(updatedItemExpiration).toBeGreaterThan(originalItemExpiration);
    expect(result1).toEqual("a");
    expect(result2).toEqual("a");
    expect(target.get(1)).toEqual("a");

    await sleep(700);
    const result3 = target.computeIfAbsent(1, () => "b", convertMsToNanos(500));
    expect(result3).toEqual("b");
    expect(target.get(1)).toEqual("b");
  });

  it("test remove", async () => {
    const target = new SlidingExpirationCache(
      BigInt(50_000_000),
      (item: DisposableItem) => item.shouldDispose,
      (item) => item.dispose()
    );
    const itemToRemove = new DisposableItem(true);
    let result = target.computeIfAbsent("itemToRemove", () => itemToRemove, convertMsToNanos(15_000));
    expect(itemToRemove).toEqual(result);

    const itemToCleanup = new DisposableItem(true);
    result = target.computeIfAbsent("itemToCleanup", () => itemToCleanup, convertMsToNanos(100));
    expect(itemToCleanup).toEqual(result);

    const nonDisposableItem = new DisposableItem(false);
    result = target.computeIfAbsent("nonDisposableItem", () => nonDisposableItem, convertMsToNanos(100));
    expect(nonDisposableItem).toEqual(result);

    const nonExpiredItem = new DisposableItem(true);
    result = target.computeIfAbsent("nonExpiredItem", () => nonExpiredItem, convertMsToNanos(15_000));
    expect(nonExpiredItem).toEqual(result);

    await sleep(700);
    target.remove("itemToRemove");

    expect(target.get("itemToRemove")).toEqual(undefined);
    expect(itemToRemove.disposed).toEqual(true);

    expect(target.get("itemToCleanup")).toEqual(undefined);
    expect(itemToRemove.disposed).toEqual(true);

    expect(target.get("nonDisposableItem")).toEqual(nonDisposableItem);
    expect(nonDisposableItem.disposed).toEqual(false);

    expect(target.get("nonExpiredItem")).toEqual(nonExpiredItem);
    expect(nonExpiredItem.disposed).toEqual(false);
  });

  it("test clear", async () => {
    const target = new SlidingExpirationCache(
      BigInt(50_000_000),
      (item: DisposableItem) => item.shouldDispose,
      (item) => item.dispose()
    );
    const item1 = new DisposableItem(false);
    const item2 = new DisposableItem(false);

    target.computeIfAbsent(1, () => item1, BigInt(15_000_000_000));
    target.computeIfAbsent(2, () => item2, BigInt(15_000_000_000));

    expect(target.size).toEqual(2);
    expect(target.get(1)).toEqual(item1);
    expect(target.get(2)).toEqual(item2);

    target.clear();

    expect(target.size).toEqual(0);
    expect(target.get(1)).toEqual(undefined);
    expect(target.get(2)).toEqual(undefined);
    expect(item1.disposed).toEqual(true);
    expect(item2.disposed).toEqual(true);
  });

  it("test async cleanup thread", async () => {
    const cleanupIntervalNanos = BigInt(300_000_000); // .3 seconds
    const disposeMs = 1000;
    const target = new SlidingExpirationCacheWithCleanupTask(
      cleanupIntervalNanos,
      (item: AsyncDisposableItem) => item.shouldDispose,
      async (item) => await item.dispose(disposeMs),
      "slidingExpirationCache.test"
    );
    const item1 = new AsyncDisposableItem(true);
    const item2 = new AsyncDisposableItem(false);

    target.computeIfAbsent(1, () => item1, BigInt(100_000_000)); // .1 seconds
    target.computeIfAbsent(2, () => item2, BigInt(15_000_000_000));

    expect(target.size).toEqual(2);
    expect(target.get(1)).toEqual(item1);
    expect(target.get(2)).toEqual(item2);

    // Item should be removed by the cleanup task after cleanupIntervalNanos have passed.
    await sleep(convertNanosToMs(cleanupIntervalNanos));

    expect(target.size).toEqual(1);
    expect(target.get(1)).toEqual(undefined);
    expect(target.get(2)).toEqual(item2);

    // Item will be cleaned up after disposalMs have passed.
    await sleep(disposeMs);

    expect(item1.disposed).toEqual(true);
    expect(item2.disposed).toEqual(false);

    await target.clear();

    expect(target.size).toEqual(0);
    expect(target.get(2)).toEqual(undefined);
    expect(item2.disposed).toEqual(true);
  });

  it("test async clear", async () => {
    const target = new SlidingExpirationCacheWithCleanupTask(
      BigInt(50_000_000),
      (item: AsyncDisposableItem) => item.shouldDispose,
      async (item) => await item.dispose(1000),
      "slidingExpirationCache.test"
    );
    const item1 = new AsyncDisposableItem(false);
    const item2 = new AsyncDisposableItem(false);

    target.computeIfAbsent(1, () => item1, BigInt(15_000_000_000));
    target.computeIfAbsent(2, () => item2, BigInt(15_000_000_000));

    expect(target.size).toEqual(2);
    expect(target.get(1)).toEqual(item1);
    expect(target.get(2)).toEqual(item2);

    await target.clear();

    expect(target.size).toEqual(0);
    expect(target.get(1)).toEqual(undefined);
    expect(target.get(2)).toEqual(undefined);
    expect(item1.disposed).toEqual(true);
    expect(item2.disposed).toEqual(true);
  });
});
