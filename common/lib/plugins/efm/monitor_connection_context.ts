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

import { Monitor } from "./monitor";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { ClientWrapper } from "../../client_wrapper";
import { sleep } from "../../utils/utils";
import { AwsWrapperError } from "../../utils/errors";
import { uniqueId } from "lodash";
import { PluginService } from "../../plugin_service";

export class MonitorConnectionContext {
  readonly failureDetectionIntervalMillis: number;
  private readonly failureDetectionTimeMillis: number;
  private readonly failureDetectionCount: number;
  readonly clientToAbort: ClientWrapper;
  readonly monitor: Monitor;
  readonly pluginService: PluginService;

  isActiveContext: boolean = true;
  isHostUnhealthy: boolean = false;
  startMonitorTimeNano: number = 0;
  expectedActiveMonitoringStartTimeNano: number = 0;
  private invalidHostStartTimeNano: number = 0;
  private abortedConnectionCounter: number = 0;
  failureCount: number = 0;
  id: string = uniqueId("_monitorContext");

  constructor(
    monitor: Monitor,
    clientToAbort: any,
    failureDetectionTimeMillis: number,
    failureDetectionIntervalMillis: number,
    failureDetectionCount: number,
    pluginService: PluginService
  ) {
    this.monitor = monitor;
    this.clientToAbort = clientToAbort;
    this.failureDetectionTimeMillis = failureDetectionTimeMillis;
    this.failureDetectionIntervalMillis = failureDetectionIntervalMillis;
    this.failureDetectionCount = failureDetectionCount;
    this.pluginService = pluginService;
  }

  resetInvalidHostStartTimeNano(): void {
    this.invalidHostStartTimeNano = 0;
  }

  isInvalidHostStartTimeDefined(): boolean {
    return this.invalidHostStartTimeNano > 0;
  }

  async abortConnection(): Promise<void> {
    if (this.clientToAbort == null || !this.isActiveContext) {
      return Promise.resolve();
    }

    try {
      await this.pluginService.tryClosingTargetClient(this.clientToAbort);
    } catch (error: any) {
      // ignore
      logger.debug(Messages.get("MonitorConnectionContext.exceptionAbortingConnection", error.message));
    }
    this.abortedConnectionCounter++;
  }

  /**
   * Update whether the connection is still valid if the total elapsed time has passed the grace period.
   * @param hostName A host name for logging purposes.
   * @param statusCheckStartNano The time when connection status check started in nanos.
   * @param statusCheckEndNano The time when connection status check ended in nanos.
   * @param isValid Whether the connection is valid.
   */
  async updateConnectionStatus(hostName: string, statusCheckStartNano: number, statusCheckEndNano: number, isValid: boolean): Promise<void> {
    if (!this.isActiveContext) {
      return;
    }

    const totalElapsedTimeNano: number = statusCheckEndNano - this.startMonitorTimeNano;
    if (totalElapsedTimeNano > this.failureDetectionTimeMillis * 1000000) {
      await this.setConnectionValid(hostName, isValid, statusCheckStartNano, statusCheckEndNano);
    }
  }

  /**
   * Set whether the connection to the server is still valid based on the monitoring settings set in the {@link AwsClient}.
   *
   * <p>These monitoring settings include:
   *
   * <ul>
   *   <li>{@code failureDetectionInterval}
   *   <li>{@code failureDetectionTime}
   *   <li>{@code failureDetectionCount}
   * </ul>
   *
   * @param hostName A host name for logging purposes.
   * @param connectionValid Boolean indicating whether the server is still responsive.
   * @param statusCheckStartNano The time when connection status check started in nanos.
   * @param statusCheckEndNano The time when connection status check ended in nanos.
   * @protected
   */
  async setConnectionValid(hostName: string, connectionValid: boolean, statusCheckStartNano: number, statusCheckEndNano: number) {
    if (!connectionValid) {
      this.failureCount++;

      if (!this.isInvalidHostStartTimeDefined()) {
        this.invalidHostStartTimeNano = statusCheckStartNano;
      }

      const invalidHostDurationNano: number = statusCheckEndNano - this.invalidHostStartTimeNano;
      const maxInvalidHostDurationMillis: number = this.failureDetectionIntervalMillis * Math.max(0, this.failureDetectionCount);

      if (this.failureCount >= this.failureDetectionCount || invalidHostDurationNano >= maxInvalidHostDurationMillis * 1_000_000) {
        logger.debug(Messages.get("MonitorConnectionContext.hostDead", hostName));
        this.isHostUnhealthy = true;
        await this.abortConnection();
        return;
      }

      logger.debug(Messages.get("MonitorConnectionContext.hostNotResponding", hostName, String(this.failureCount)));
      return;
    }

    this.failureCount = 0;
    this.resetInvalidHostStartTimeNano();
    this.isHostUnhealthy = false;

    logger.debug(Messages.get("MonitorConnectionContext.hostAlive", hostName));
  }

  async trackHealthStatus() {
    while (!this.isHostUnhealthy && this.isActiveContext) {
      await sleep(100);
    }

    throw new AwsWrapperError("trackHealthStatus stopped");
  }
}
