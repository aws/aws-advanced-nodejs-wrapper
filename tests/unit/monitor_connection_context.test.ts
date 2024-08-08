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

import { instance, mock, spy, verify } from "ts-mockito";
import { MonitorConnectionContext } from "../../common/lib/plugins/efm/monitor_connection_context";
import { MonitorImpl } from "../../common/lib/plugins/efm/monitor";

const mockMonitor = mock(MonitorImpl);
const mockTargetClient = {
  end() {
    throw new Error("close");
  }
};

const FAILURE_DETECTION_TIME_MILLIS = 10;
const FAILURE_DETECTION_INTERVAL_MILLIS = 100;
const FAILURE_DETECTION_COUNT = 3;
const VALIDATION_INTERVAL_MILLIS = 50;

let context: MonitorConnectionContext;

describe("monitor connection context test", () => {
  beforeEach(() => {
    context = new MonitorConnectionContext(
      instance(mockMonitor),
      null,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );
  });

  it("isHostUnhealthy with valid connection", async () => {
    const currentTimeNano = Date.now();
    await context.setConnectionValid("test-node", true, currentTimeNano, currentTimeNano);
    expect(context.isHostUnhealthy).toBe(false);
    expect(context.failureCount).toBe(0);
  });

  it("isHostUnhealthy with invalid connection", async () => {
    const currentTimeNano = Date.now();
    await context.setConnectionValid("test-node", false, currentTimeNano, currentTimeNano);
    expect(context.isHostUnhealthy).toBe(false);
    expect(context.failureCount).toBe(1);
  });

  it("isHostUnhealthy exceeds failure detection count - return true", async () => {
    const expectedFailureCount = FAILURE_DETECTION_COUNT + 1;
    context.failureCount = FAILURE_DETECTION_COUNT;
    context.resetInvalidHostStartTimeNano();

    const currentTimeNano = Date.now();
    await context.setConnectionValid("test-node", false, currentTimeNano, currentTimeNano);

    expect(context.isHostUnhealthy).toBe(false);
    expect(context.failureCount).toBe(expectedFailureCount);
    expect(context.isInvalidHostStartTimeDefined()).toBe(true);
  });

  it("isHostUnhealthy exceeds failure detection count", async () => {
    let currentTimeNano = Date.now();
    context.failureCount = 0;
    context.resetInvalidHostStartTimeNano();

    for (let i = 0; i < 5; i++) {
      const statusCheckStartTime = currentTimeNano;
      const statusCheckEndTime = currentTimeNano + VALIDATION_INTERVAL_MILLIS * 1_000_000;

      await context.setConnectionValid("test-node", false, statusCheckStartTime, statusCheckEndTime);
      expect(context.isHostUnhealthy).toBe(false);

      currentTimeNano += VALIDATION_INTERVAL_MILLIS * 1_000_000;
    }

    const statusCheckStartTime = currentTimeNano;
    const statusCheckEndTime = currentTimeNano + VALIDATION_INTERVAL_MILLIS * 1_000_000;
    await context.setConnectionValid("test-node", false, statusCheckStartTime, statusCheckEndTime);
    expect(context.isHostUnhealthy).toBe(true);
  });

  it.each([[true], [false]])("updateConnectionStatus", async (isValid: boolean) => {
    const currentTimeNano = Date.now();
    const statusCheckStartTime = Date.now() - FAILURE_DETECTION_TIME_MILLIS * 1_000_000;

    const contextSpy = spy(context);
    await context.updateConnectionStatus("test-node", statusCheckStartTime, currentTimeNano, isValid);

    verify(contextSpy.setConnectionValid("test-node", isValid, statusCheckStartTime, currentTimeNano)).once();
  });

  it("updateConnectionStatus - inactive context", async () => {
    const currentTimeNano = Date.now();
    const statusCheckStartTime = Date.now() - 1000;
    context.isActiveContext = false;

    const contextSpy = spy(context);
    await context.updateConnectionStatus("test-node", statusCheckStartTime, currentTimeNano, true);

    verify(contextSpy.setConnectionValid("test-node", true, statusCheckStartTime, currentTimeNano)).never();
  });

  it("abort client ignores error", async () => {
    context = new MonitorConnectionContext(
      instance(mockMonitor),
      mockTargetClient,
      FAILURE_DETECTION_TIME_MILLIS,
      FAILURE_DETECTION_INTERVAL_MILLIS,
      FAILURE_DETECTION_COUNT
    );

    await context.abortConnection();
  });
});
