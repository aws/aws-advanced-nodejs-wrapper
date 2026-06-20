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

import { ClientWrapper } from "../../../client_wrapper";
import { TelemetryCounter } from "../../../utils/telemetry/telemetry_counter";
import { logger } from "../../../../logutils";
import { Messages } from "../../../utils/messages";
import { getCurrentTimeNano } from "../../../utils/utils";

/**
 * Monitoring context for each connection. This contains each connection's criteria for whether a
 * host should be considered unhealthy. The context is shared between the main task and the
 * monitor task.
 */
export interface ConnectionContext {
  readonly failureDetectionIntervalMillis: number;
  readonly failureDetectionCount: number;
  readonly expectedActiveMonitoringStartTimeNano: number;

  isActiveContext(): boolean;
  isHostUnhealthy(): boolean;
  setInactive(): void;
  abortConnection(): Promise<void>;
  updateConnectionStatus(hostName: string, statusCheckStartTimeNano: number, statusCheckEndTimeNano: number, isValid: boolean): Promise<void>;
}

export class ConnectionContextImpl implements ConnectionContext {
  readonly failureDetectionIntervalMillis: number;
  readonly failureDetectionCount: number;
  readonly expectedActiveMonitoringStartTimeNano: number;

  private readonly failureDetectionTimeMillis: number;
  private readonly connectionToAbortRef: WeakRef<ClientWrapper>;
  private readonly abortedConnectionsCounter: TelemetryCounter;
  private readonly startMonitorTimeNano: number;

  private _activeContext: boolean = true;
  private _hostUnhealthy: boolean = false;
  private invalidHostStartTimeNano: number = 0;
  private failureCount: number = 0;

  constructor(
    connectionToAbort: ClientWrapper,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number,
    abortedConnectionsCounter: TelemetryCounter
  ) {
    this.connectionToAbortRef = new WeakRef(connectionToAbort);
    this.failureDetectionTimeMillis = failureDetectionTimeMillis;
    this.failureDetectionIntervalMillis = failureDetectionIntervalMillis;
    this.failureDetectionCount = failureDetectionCount;
    this.abortedConnectionsCounter = abortedConnectionsCounter;
    this.startMonitorTimeNano = getCurrentTimeNano();
    this.expectedActiveMonitoringStartTimeNano = this.startMonitorTimeNano + this.failureDetectionTimeMillis * 1_000_000;
  }

  isActiveContext(): boolean {
    return this._activeContext;
  }

  isHostUnhealthy(): boolean {
    return this._hostUnhealthy;
  }

  setInactive(): void {
    this._activeContext = false;
  }

  async abortConnection(): Promise<void> {
    const connectionToAbort = this.connectionToAbortRef.deref();
    if (connectionToAbort == null || !this._activeContext) {
      return;
    }

    try {
      await connectionToAbort.abort();
      this.abortedConnectionsCounter.inc();
    } catch (error: any) {
      // ignore
      logger.debug(Messages.get("MonitorConnectionContext.errorAbortingConnection", error.message));
    }
  }

  /**
   * Update whether the connection is still valid if the total elapsed time has passed the
   * grace period.
   */
  async updateConnectionStatus(hostName: string, statusCheckStartTimeNano: number, statusCheckEndTimeNano: number, isValid: boolean): Promise<void> {
    if (!this._activeContext) {
      return;
    }

    const totalElapsedTimeNano = statusCheckEndTimeNano - this.startMonitorTimeNano;

    if (totalElapsedTimeNano > this.failureDetectionTimeMillis * 1_000_000) {
      await this.setConnectionValid(hostName, isValid, statusCheckStartTimeNano, statusCheckEndTimeNano);
    }
  }

  private async setConnectionValid(
    hostName: string,
    connectionValid: boolean,
    statusCheckStartNano: number,
    statusCheckEndNano: number
  ): Promise<void> {
    if (!connectionValid) {
      this.failureCount++;

      if (this.invalidHostStartTimeNano === 0) {
        this.invalidHostStartTimeNano = statusCheckStartNano;
      }

      const invalidHostDurationNano = statusCheckEndNano - this.invalidHostStartTimeNano;
      const maxInvalidHostDurationNano = this.failureDetectionIntervalMillis * Math.max(0, this.failureDetectionCount) * 1_000_000;

      if (invalidHostDurationNano >= maxInvalidHostDurationNano) {
        logger.debug(Messages.get("MonitorConnectionContext.hostDead", hostName));
        this._hostUnhealthy = true;
        await this.abortConnection();
        return;
      }

      logger.debug(Messages.get("MonitorConnectionContext.hostNotResponding", hostName));
      return;
    }

    this.failureCount = 0;
    this.invalidHostStartTimeNano = 0;
    this._hostUnhealthy = false;

    logger.debug(Messages.get("MonitorConnectionContext.hostAlive", hostName));
  }
}
