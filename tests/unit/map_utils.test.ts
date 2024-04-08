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

import { MapUtils as MapUtils } from "aws-wrapper-common-lib/lib/utils/map_utils";
import { spy, verify } from "ts-mockito";

class SomeClass {
  someMethod() {}
}

describe("test_map", () => {
  it.each([
    ["a", 2],
    ["b", 2]
  ])("test_put_if_absent", (key, val) => {
    const target = new MapUtils();
    target.putIfAbsent(key, val);
    expect(target.size).toEqual(1);
    expect(target.get(key)).toEqual(val);
  });
  it.each([
    ["a", () => undefined, undefined],
    ["b", () => 3, 3]
  ])("test_compute_if_absent", (key, val, res) => {
    const target = new MapUtils();
    target.computeIfAbsent(key, val);
    expect(target.get(key)).toEqual(res);
  });
  it.each([1])("test_compute_if_absent", (key) => {
    const target = new MapUtils();
    target.computeIfAbsent(key, () => undefined);
    expect(target.get(key)).toEqual(undefined);

    target.computeIfAbsent(key, () => "a");
    expect(target.get(key)).toEqual("a");

    target.computeIfAbsent(key, () => "b");
    expect(target.get(key)).toEqual("a");
  });
  it.each([1])("test_compute_if_present", (key) => {
    const target = new MapUtils();
    target.computeIfPresent(key, () => "a");
    expect(target.get(key)).toEqual(undefined);

    target.putIfAbsent(key, "a");
    expect(target.get(key)).toEqual("a");
    target.computeIfPresent(1, () => undefined);
    expect(target.get(key)).toEqual(undefined);

    target.putIfAbsent(key, "a");
    expect(target.get(key)).toEqual("a");
    target.computeIfPresent(key, () => "b");
    expect(target.get(key)).toEqual("b");
  });
  it("test_clear", () => {
    const target = new MapUtils();
    target.putIfAbsent(1, "a");
    target.putIfAbsent(2, "b");
    expect(target.get(1)).toEqual("a");
    expect(target.get(2)).toEqual("b");

    target.clear();
    expect(target.get(1)).toEqual(undefined);
    expect(target.get(2)).toEqual(undefined);
  });
  it("test_remove", () => {
    const target = new MapUtils();
    target.putIfAbsent(1, "a");
    target.putIfAbsent(2, "b");
    expect(target.get(1)).toEqual("a");
    expect(target.get(2)).toEqual("b");

    target.remove(1);
    expect(target.get(1)).toEqual(undefined);
    expect(target.get(2)).toEqual("b");
  });
  it("test_remove_if", () => {
    const target = new MapUtils();
    target.putIfAbsent(1, [1, 2]);
    target.putIfAbsent(2, [2, 3]);
    target.putIfAbsent(3, [4, 5]);
    expect(target.size).toEqual(3);

    expect(target.removeIf((v, k) => v.includes(2))).toBeTruthy();
    expect(target.size).toEqual(1);
    expect(target.get(1)).toEqual(undefined);
    expect(target.get(2)).toEqual(undefined);
    expect(target.get(3)).toEqual([4, 5]);

    expect(target.removeIf((v, k) => v.includes(3))).toBeFalsy();
    expect(target.size).toEqual(1);
    expect(target.get(3)).toEqual([4, 5]);
  });
  it("test_remove_matching_values", () => {
    const target = new MapUtils();
    target.putIfAbsent(1, "a");
    target.putIfAbsent(2, "b");
    target.putIfAbsent(3, "c");

    expect(target.removeMatchingValues(["a", "b"])).toBeTruthy();
    expect(target.size).toEqual(1);
    expect(target.get(1)).toEqual(undefined);
    expect(target.get(2)).toEqual(undefined);
    expect(target.get(3)).toEqual("c");
    expect(target.removeIf((v, k) => v.includes(3))).toBeFalsy();
    expect(target.size).toEqual(1);
    expect(target.get(3)).toEqual("c");
  });
  it("test_apply_if", () => {
    const target = new MapUtils();
    const spies = [];
    const numObjects = 3;
    const numApplications = numObjects - 1;
    for (let i = 0; i < numObjects; i++) {
      const someObject: SomeClass = new SomeClass();
      target.putIfAbsent(i, someObject);
      const spiedObject = spy(someObject);
      spies.push(spiedObject);
    }

    target.applyIf(
      (v, k) => k < numObjects - 1,
      (v, k) => v.someMethod()
    );

    for (let i = 0; i < numApplications; i++) {
      verify(spies[i].someMethod()).once();
    }
  });
});
