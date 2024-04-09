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

export class MapUtils<K, V> {
  protected map: Map<K, V> = new Map<K, V>();

  get size(): number {
    return this.map.size;
  }

  get keys() {
    return this.map.keys();
  }

  get entries() {
    return this.map.entries();
  }

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  clear() {
    this.map.clear();
  }

  computeIfPresent(key: K, remappingFunc: (key: K, existingValue: V) => V | null): V | undefined {
    const existingValue: V | undefined = this.map.get(key);
    if (existingValue === undefined) {
      return undefined;
    }
    const newValue: any = remappingFunc(key, existingValue);
    if (newValue !== null) {
      this.map.set(key, newValue);
      return newValue;
    } else {
      this.map.delete(key);
      return undefined;
    }
  }

  computeIfAbsent(key: K, mappingFunc: (key: K) => V | null): V | undefined {
    const value: V | undefined = this.map.get(key);
    if (value == undefined) {
      const newValue: V | null = mappingFunc(key);
      if (newValue !== null) {
        this.map.set(key, newValue);
        return newValue;
      }
      return undefined;
    }
    return value;
  }

  putIfAbsent(key: K, newValue: V): V | undefined {
    const existingValue: V | undefined = this.map.get(key);
    if (existingValue === undefined) {
      this.map.set(key, newValue);
      return newValue;
    }
    return existingValue;
  }

  remove(key: K): V | undefined {
    const value = this.map.get(key);
    this.map.delete(key);
    return value;
  }

  removeIf(predicate: (v: any, k: any) => V): boolean {
    const originalSize = this.size;
    this.map.forEach((v, k) => {
      if (predicate(v, k)) {
        this.remove(k);
      }
    });
    return this.size < originalSize;
  }

  removeMatchingValues(removalValues: any[]): boolean {
    const originalSize = this.size;
    this.map.forEach((v, k) => {
      if (removalValues.includes(v)) {
        this.remove(k);
      }
    });
    return this.size < originalSize;
  }

  applyIf(predicate: (v: any, k: any) => V, apply: (v: any, k: any) => V): void {
    const originalSize = this.size;
    this.map.forEach((v, k) => {
      if (predicate(v, k)) {
        apply(v, k);
      }
    });
  }
}
