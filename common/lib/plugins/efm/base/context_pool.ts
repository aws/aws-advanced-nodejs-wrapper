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

import { ConnectionContext } from "./connection_context";

/**
 * Manages active and pending monitoring contexts grouped by host.
 */
export interface ContextPool {
  /**
   * Add a new context to the pool for the given host.
   */
  addContext(hostKey: string, context: ConnectionContext): void;

  /**
   * Get all active contexts for the given host.
   */
  getActiveContexts(hostKey: string): ConnectionContext[];

  /**
   * Move pending contexts whose grace period has elapsed into the active set.
   * Returns the contexts that were promoted.
   */
  promoteReadyContexts(hostKey: string, currentTimeNano: number): ConnectionContext[];

  /**
   * Remove inactive or unhealthy contexts from the pool for the given host.
   * Returns the contexts that were removed.
   */
  removeInactiveContexts(hostKey: string): ConnectionContext[];

  /**
   * Remove all contexts for the given host.
   */
  clear(hostKey: string): void;

  /**
   * Remove all contexts from the pool.
   */
  clearAll(): void;

  /**
   * Returns true if the pool has any active or pending contexts for the given host.
   */
  hasContexts(hostKey: string): boolean;

  /**
   * Returns the total number of active contexts for the given host.
   */
  activeCount(hostKey: string): number;
}

export class ContextPoolImpl implements ContextPool {
  private readonly activeContexts: Map<string, ConnectionContext[]> = new Map();
  private readonly pendingContexts: Map<string, ConnectionContext[]> = new Map();

  addContext(hostKey: string, context: ConnectionContext): void {
    let pending = this.pendingContexts.get(hostKey);
    if (!pending) {
      pending = [];
      this.pendingContexts.set(hostKey, pending);
    }
    pending.push(context);
  }

  getActiveContexts(hostKey: string): ConnectionContext[] {
    return this.activeContexts.get(hostKey) ?? [];
  }

  promoteReadyContexts(hostKey: string, currentTimeNano: number): ConnectionContext[] {
    const pending = this.pendingContexts.get(hostKey);
    if (!pending || pending.length === 0) {
      return [];
    }

    const promoted: ConnectionContext[] = [];
    const remaining: ConnectionContext[] = [];

    for (const ctx of pending) {
      if (!ctx.isActiveContext()) {
        continue;
      }
      if (ctx.expectedActiveMonitoringStartTimeNano <= currentTimeNano) {
        promoted.push(ctx);
      } else {
        remaining.push(ctx);
      }
    }

    this.pendingContexts.set(hostKey, remaining);

    if (promoted.length > 0) {
      let active = this.activeContexts.get(hostKey);
      if (!active) {
        active = [];
        this.activeContexts.set(hostKey, active);
      }
      active.push(...promoted);
    }

    return promoted;
  }

  removeInactiveContexts(hostKey: string): ConnectionContext[] {
    const active = this.activeContexts.get(hostKey);
    if (!active || active.length === 0) {
      return [];
    }

    const removed: ConnectionContext[] = [];
    const remaining: ConnectionContext[] = [];

    for (const ctx of active) {
      if (!ctx.isActiveContext() || ctx.isHostUnhealthy()) {
        removed.push(ctx);
      } else {
        remaining.push(ctx);
      }
    }

    this.activeContexts.set(hostKey, remaining);
    return removed;
  }

  clear(hostKey: string): void {
    this.activeContexts.delete(hostKey);
    this.pendingContexts.delete(hostKey);
  }

  clearAll(): void {
    this.activeContexts.clear();
    this.pendingContexts.clear();
  }

  hasContexts(hostKey: string): boolean {
    const active = this.activeContexts.get(hostKey);
    const pending = this.pendingContexts.get(hostKey);
    return (active != null && active.length > 0) || (pending != null && pending.length > 0);
  }

  activeCount(hostKey: string): number {
    return this.activeContexts.get(hostKey)?.length ?? 0;
  }
}
