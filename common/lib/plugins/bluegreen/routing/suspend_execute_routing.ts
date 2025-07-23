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

import { PluginService } from "../../../plugin_service";
import { BaseExecuteRouting } from "./base_execute_routing";
import { BlueGreenRole } from "../blue_green_role";
import { Messages } from "../../../utils/messages";
import { logger } from "../../../../logutils";
import { TelemetryFactory } from "../../../utils/telemetry/telemetry_factory";
import { TelemetryContext } from "../../../utils/telemetry/telemetry_context";
import { TelemetryTraceLevel } from "../../../utils/telemetry/telemetry_trace_level";
import { BlueGreenStatus } from "../blue_green_status";
import { convertMsToNanos, convertNanosToMs, getTimeInNanos } from "../../../utils/utils";
import { WrapperProperties } from "../../../wrapper_property";
import { BlueGreenPhase } from "../blue_green_phase";
import { TimeoutError } from "@opentelemetry/sdk-metrics";
import { ConnectionPlugin } from "../../../connection_plugin";
import { RoutingResultHolder } from "./execute_routing";

export class SuspendExecuteRouting extends BaseExecuteRouting {
  protected static readonly TELEMETRY_SWITCHOVER: string = "Blue/Green switchover";
  private static readonly SLEEP_TIME_MS: number = 100;

  protected bgdId: string;

  constructor(hostAndPort: string, role: BlueGreenRole, bgdId: string) {
    super(hostAndPort, role);
    this.bgdId = bgdId;
  }

  async apply<T>(
    plugin: ConnectionPlugin,
    methodName: string,
    methodFunc: () => Promise<T>,
    methodArgs: any,
    properties: Map<string, any>,
    pluginService: PluginService
  ): Promise<RoutingResultHolder<T>> {
    logger.debug(Messages.get("Bgd.inProgressSuspendMethod", methodName));

    const telemetryFactory: TelemetryFactory = pluginService.getTelemetryFactory();
    const telemetryContext: TelemetryContext = telemetryFactory.openTelemetryContext(
      SuspendExecuteRouting.TELEMETRY_SWITCHOVER,
      TelemetryTraceLevel.NESTED
    );

    return await telemetryContext.start(async () => {
      let bgStatus: BlueGreenStatus = pluginService.getStatus<BlueGreenStatus>(BlueGreenStatus, this.bgdId);
      const timeoutNanos: bigint = convertMsToNanos(WrapperProperties.BG_CONNECT_TIMEOUT_MS.get(properties));
      const suspendStartTime: bigint = getTimeInNanos();
      const endTime: bigint = getTimeInNanos() + timeoutNanos;

      while (getTimeInNanos() <= endTime && bgStatus != null && bgStatus.currentPhase === BlueGreenPhase.IN_PROGRESS) {
        await this.delay(SuspendExecuteRouting.SLEEP_TIME_MS, bgStatus, pluginService, this.bgdId);

        bgStatus = pluginService.getStatus<BlueGreenStatus>(BlueGreenStatus, this.bgdId);
      }

      if (bgStatus != null && bgStatus.currentPhase === BlueGreenPhase.IN_PROGRESS) {
        throw new TimeoutError(Messages.get("Bgd.stillInProgressTryMethodLater", `${WrapperProperties.BG_CONNECT_TIMEOUT_MS.get(properties)}`));
      }

      logger.debug(Messages.get("Bgd.switchoverCompletedContinueWithMethod", methodName, `${convertNanosToMs(getTimeInNanos() - suspendStartTime)}`));

      return RoutingResultHolder.empty();
    });
  }
}
