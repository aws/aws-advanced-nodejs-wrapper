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

import { mock } from "ts-mockito";
import { ConnectionContextImpl } from "../../common/lib/plugins/efm/base/connection_context";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { MySQLClientWrapper } from "../../common/lib/mysql_client_wrapper";
import { HostInfo } from "../../common/lib";
import { MySQL2DriverDialect } from "../../mysql/lib/dialect/mysql2_driver_dialect";
import { getCurrentTimeNano } from "../../common/lib/utils/utils";

const mockClientWrapper = new MySQLClientWrapper(undefined, mock(HostInfo), new Map<string, any>(), new MySQL2DriverDialect());

const FAILURE_DETECTION_TIME_MILLIS = 10;
const FAILURE_DETECTION_INTERVAL_MILLIS = 100;
const FAILURE_DETECTION_COUNT = 3;
const VALIDATION_INTERVAL_MILLIS = 50;

let context: ConnectionContextImpl;

describe("connection context test", () => {
  beforeEach(() => {
    context = new ConnectionContextImpl(
      mockClientWrapper,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT,
      new NullTelemetryFactory().createCounter("counter")
    );
  });

  it("isHostUnhealthy with valid connection", async () => {
    const ctx = new ConnectionContextImpl(
      mockClientWrapper,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT,
      new NullTelemetryFactory().createCounter("counter")
    );
    // Timestamps must exceed the grace period relative to context's startMonitorTimeNano (hrtime-based)
    const checkStart = getCurrentTimeNano() + (FAILURE_DETECTION_TIME_MILLIS + 100) * 1_000_000;
    const checkEnd = checkStart + 1_000_000;
    await ctx.updateConnectionStatus("test-node", checkStart, checkEnd, true);
    expect(ctx.isHostUnhealthy()).toBe(false);
  });

  it("isHostUnhealthy with invalid connection - single failure", async () => {
    const ctx = new ConnectionContextImpl(
      mockClientWrapper,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT,
      new NullTelemetryFactory().createCounter("counter")
    );
    const checkStart = getCurrentTimeNano() + (FAILURE_DETECTION_TIME_MILLIS + 100) * 1_000_000;
    const checkEnd = checkStart + 1_000_000;
    await ctx.updateConnectionStatus("test-node", checkStart, checkEnd, false);
    // Single failure doesn't exceed threshold
    expect(ctx.isHostUnhealthy()).toBe(false);
  });

  it("isHostUnhealthy exceeds failure detection threshold", async () => {
    const ctx = new ConnectionContextImpl(
      mockClientWrapper,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT,
      new NullTelemetryFactory().createCounter("counter")
    );

    // Use timestamps far enough in the future to exceed the grace period (failureDetectionTimeMillis).
    // The context's startMonitorTimeNano is hrtime-based (~now), so we simulate checks starting after the grace period.
    const futureStartNano = getCurrentTimeNano() + (FAILURE_DETECTION_TIME_MILLIS + 100) * 1_000_000;

    // maxInvalidHostDuration = failureDetectionIntervalMillis * failureDetectionCount = 100 * 3 = 300ms
    // Each check spans FAILURE_DETECTION_INTERVAL_MILLIS (100ms), so after 3 checks the duration exceeds threshold.
    for (let i = 0; i < FAILURE_DETECTION_COUNT + 2; i++) {
      const checkStart = futureStartNano + i * FAILURE_DETECTION_INTERVAL_MILLIS * 1_000_000;
      const checkEnd = checkStart + FAILURE_DETECTION_INTERVAL_MILLIS * 1_000_000;

      await ctx.updateConnectionStatus("test-node", checkStart, checkEnd, false);

      if (ctx.isHostUnhealthy()) {
        break;
      }
    }

    expect(ctx.isHostUnhealthy()).toBe(true);
  });

  it("updateConnectionStatus skips within grace period", async () => {
    // Use a context with a long grace period
    const ctx = new ConnectionContextImpl(
      mockClientWrapper,
      30000, // 30s grace
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT,
      new NullTelemetryFactory().createCounter("counter")
    );

    // Call with a time that's within the grace period (elapsed < failureDetectionTime)
    const now = getCurrentTimeNano();
    await ctx.updateConnectionStatus("test-node", now, now + 1_000_000, false);

    // Should not have detected unhealthy since we're within grace period
    expect(ctx.isHostUnhealthy()).toBe(false);
  });

  it("updateConnectionStatus skips for inactive context", async () => {
    context.setInactive();
    expect(context.isActiveContext()).toBe(false);

    const now = getCurrentTimeNano();
    await context.updateConnectionStatus("test-node", now, now + 100_000_000, false);

    // Should remain not-unhealthy since the context is inactive
    expect(context.isHostUnhealthy()).toBe(false);
  });

  it("setInactive marks context inactive", () => {
    expect(context.isActiveContext()).toBe(true);
    context.setInactive();
    expect(context.isActiveContext()).toBe(false);
  });

  it("abortConnection does nothing for inactive context", async () => {
    context.setInactive();
    // Should not throw
    await context.abortConnection();
  });
});
