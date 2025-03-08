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
import { sleep } from "../../common/lib/utils/utils";

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

describe("test_sliding_expiration_cache", () => {
  it("test_compute_if_absent", async () => {
    const target = new SlidingExpirationCache(BigInt(50_000_000));
    const result1 = target.computeIfAbsent(1, () => "a", BigInt(1));
    const originalItemExpiration = target.map.get(1)!.expirationTimeNs;
    const result2 = target.computeIfAbsent(1, () => "b", BigInt(5));
    const updatedItemExpiration = target.map.get(1)?.expirationTimeNs;

    expect(updatedItemExpiration).toBeGreaterThan(originalItemExpiration);
    expect(result1).toEqual("a");
    expect(result2).toEqual("a");
    expect(target.get(1)).toEqual("a");

    await sleep(700);
    const result3 = target.computeIfAbsent(1, () => "b", BigInt(5));
    expect(result3).toEqual("b");
    expect(target.get(1)).toEqual("b");
  });
  it("test_remove", async () => {
    const target = new SlidingExpirationCache(
      BigInt(50_000_000),
      (item: DisposableItem) => item.shouldDispose,
      (item) => item.dispose()
    );
    const itemToRemove = new DisposableItem(true);
    let result = target.computeIfAbsent("itemToRemove", () => itemToRemove, BigInt(15_000_000_000));
    expect(itemToRemove).toEqual(result);

    const itemToCleanup = new DisposableItem(true);
    result = target.computeIfAbsent("itemToCleanup", () => itemToCleanup, BigInt(1));
    expect(itemToCleanup).toEqual(result);

    const nonDisposableItem = new DisposableItem(false);
    result = target.computeIfAbsent("nonDisposableItem", () => nonDisposableItem, BigInt(1));
    expect(nonDisposableItem).toEqual(result);

    const nonExpiredItem = new DisposableItem(true);
    result = target.computeIfAbsent("nonExpiredItem", () => nonExpiredItem, BigInt(15_000_000_000));
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
  it("test_clear", async () => {
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
});
