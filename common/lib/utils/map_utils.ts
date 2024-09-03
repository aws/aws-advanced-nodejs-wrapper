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

export class MapUtils {
  static computeIfPresent<K, V>(map: Map<K, V>, key: K, remappingFunc: (key: K, existingValue: V) => V | null): V | undefined {
    const existingValue: V | undefined = map.get(key);
    if (existingValue === undefined) {
      return undefined;
    }
    const newValue: any = remappingFunc(key, existingValue);
    if (newValue !== null) {
      map.set(key, newValue);
      return newValue;
    } else {
      map.delete(key);
      return undefined;
    }
  }

  static computeIfAbsent<K, V>(map: Map<K, V>, key: K, mappingFunc: (key: K) => V | null): V | undefined {
    const value: V | undefined = map.get(key);
    if (value == undefined) {
      const newValue: V | null = mappingFunc(key);
      if (newValue !== null) {
        map.set(key, newValue);
        return newValue;
      }
      return undefined;
    }
    return value;
  }

  static putIfAbsent<K, V>(map: Map<K, V>, key: K, newValue: V): V | undefined {
    const existingValue: V | undefined = map.get(key);
    if (existingValue === undefined) {
      map.set(key, newValue);
      return newValue;
    }
    return existingValue;
  }

  static remove<K, V>(map: Map<K, V>, key: K): V | undefined {
    const value = map.get(key);
    map.delete(key);
    return value;
  }

  static removeIf<K, V>(map: Map<K, V>, predicate: (v: any, k: any) => V): boolean {
    const originalSize = map.size;
    map.forEach((v, k) => {
      if (predicate(v, k)) {
        this.remove(map, k);
      }
    });
    return map.size < originalSize;
  }

  static removeMatchingValues<K, V>(map: Map<K, V>, removalValues: any[]): boolean {
    const originalSize = map.size;
    map.forEach((v, k) => {
      if (removalValues.includes(v)) {
        this.remove(map, k);
      }
    });
    return map.size < originalSize;
  }

  static applyIf<K, V>(map: Map<K, V>, predicate: (v: any, k: any) => V, apply: (v: any, k: any) => V): void {
    const originalSize = map.size;
    map.forEach((v, k) => {
      if (predicate(v, k)) {
        apply(v, k);
      }
    });
  }
}
