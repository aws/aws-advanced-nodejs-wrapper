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

import { FullServicesContainer } from "../full_services_container";

const DEFAULT_CLEANUP_INTERVAL_NANOS = BigInt(60_000_000_000); // 1 minute

export enum MonitorState {
  RUNNING,
  STOPPED,
  ERROR
}

export enum MonitorErrorResponse {
  STOP_MONITOR,
  LOG_WARNING,
  THROW_EXCEPTION
}

export class MonitorSettings {
  expirationTimeoutNanos: bigint;
  inactiveTimeoutNanos: bigint;
  errorResponses: Set<MonitorErrorResponse>;

  constructor(expirationTimeoutNanos: bigint, inactiveTimeoutNanos: bigint, errorResponses: Set<MonitorErrorResponse>) {
    this.expirationTimeoutNanos = expirationTimeoutNanos;
    this.inactiveTimeoutNanos = inactiveTimeoutNanos;
    this.errorResponses = errorResponses;
  }
}

export interface Monitor {
  start(): void;

  monitor(): Promise<void>;

  stop(): void;

  close(): void;

  getLastActivityTimestampNanos(): bigint;

  getState(): MonitorState;

  canDispose(): boolean;
}

export interface MonitorInitializer {
  createMonitor(servicesContainer: FullServicesContainer): Monitor;
}

export abstract class AbstractMonitor implements Monitor {
  protected _stop = false;
  protected terminationTimeoutMs: number;
  protected lastActivityTimestampNanos: bigint;
  protected state: MonitorState;
  protected monitorPromise?: Promise<void>;

  protected constructor(terminationTimeoutSec: number) {
    this.terminationTimeoutMs = terminationTimeoutSec * 1000;
    this.lastActivityTimestampNanos = BigInt(Date.now() * 1_000_000);
    this.state = MonitorState.STOPPED;
  }

  start(): void {
    this.monitorPromise = this.run();
  }

  protected async run(): Promise<void> {
    try {
      this.state = MonitorState.RUNNING;
      this.lastActivityTimestampNanos = BigInt(Date.now() * 1_000_000);
      await this.monitor();
    } catch (error) {
      this.state = MonitorState.ERROR;
    } finally {
      this.close();
    }
  }

  abstract monitor(): Promise<void>;

  async stop(): Promise<void> {
    this._stop = true;

    if (this.monitorPromise) {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, this.terminationTimeoutMs));
      await Promise.race([this.monitorPromise, timeout]);
    }

    this.close();
    this.state = MonitorState.STOPPED;
  }

  close(): void {
    // Do nothing
  }

  getLastActivityTimestampNanos(): bigint {
    return this.lastActivityTimestampNanos;
  }

  getState(): MonitorState {
    return this.state;
  }

  canDispose(): boolean {
    return true;
  }
}
