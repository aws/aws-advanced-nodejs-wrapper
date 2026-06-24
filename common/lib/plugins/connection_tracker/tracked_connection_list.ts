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

import { ClientWrapper } from "../../client_wrapper";

/**
 * A handle to a single connection tracked within a {@link TrackedConnectionList}.
 * Holding onto a host allows the tracked connection to be removed later without
 * having to search the entire list.
 */
export class TrackedConnection {
  private readonly list: TrackedConnectionList;
  private readonly ref: WeakRef<ClientWrapper>;

  constructor(list: TrackedConnectionList, ref: WeakRef<ClientWrapper>) {
    this.list = list;
    this.ref = ref;
  }

  /**
   * Stop tracking the connection this host refers to.
   */
  remove(): void {
    this.list.removeRef(this.ref);
  }
}

/**
 * Tracks opened connections for a single host. Connections are held via weak
 * references so that clients which are no longer referenced elsewhere can be
 * garbage collected without leaking through this list.
 */
export class TrackedConnectionList {
  private readonly connections: WeakRef<ClientWrapper>[] = [];

  /**
   * Track a new connection and return a handle that can be used to stop tracking it.
   */
  add(client: ClientWrapper): TrackedConnection {
    const ref = new WeakRef(client);
    this.connections.push(ref);
    return new TrackedConnection(this, ref);
  }

  /**
   * Remove a specific weak reference from the list, if present.
   */
  removeRef(ref: WeakRef<ClientWrapper>): void {
    const index = this.connections.indexOf(ref);
    if (index !== -1) {
      this.connections.splice(index, 1);
    }
  }

  /**
   * Remove every tracked reference for which the predicate returns true.
   */
  removeIf(predicate: (ref: WeakRef<ClientWrapper>) => boolean): void {
    for (let i = this.connections.length - 1; i >= 0; i--) {
      if (predicate(this.connections[i])) {
        this.connections.splice(i, 1);
      }
    }
  }

  /**
   * Whether there are no tracked references remaining. Note that a reference
   * whose client has been garbage collected still counts until it is pruned.
   */
  isEmpty(): boolean {
    return this.connections.length === 0;
  }

  /**
   * Return the live clients that are still tracked, skipping any whose weak
   * reference has been cleared.
   */
  getConnections(): ClientWrapper[] {
    const connections: ClientWrapper[] = [];
    for (const ref of this.connections) {
      const client = ref.deref();
      if (client) {
        connections.push(client);
      }
    }
    return connections;
  }

  /**
   * Return all live clients and clear the list.
   */
  drainAll(): ClientWrapper[] {
    const connections = this.getConnections();
    this.connections.length = 0;
    return connections;
  }
}
