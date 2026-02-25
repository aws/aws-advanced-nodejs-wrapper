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

/**
 * Type representing a constructor for any class.
 */
export type Constructor<T = unknown> = new (...args: unknown[]) => T;

/**
 * Function type that determines whether an item should be disposed when expired.
 * @param item The item to check
 * @returns true if the item should be disposed, false otherwise
 */
export type ShouldDisposeFunc<V> = (item: V) => boolean;

/**
 * Function type that defines how to dispose of an item when it is removed.
 * @param item The item to dispose
 */
export type ItemDisposalFunc<V> = (item: V) => void;
