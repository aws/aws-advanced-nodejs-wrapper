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

import { BaseConnectRouting } from "./base_connect_routing";
import { ConnectionPlugin } from "../../../connection_plugin";
import { HostInfo } from "../../../host_info";
import { ClientWrapper } from "../../../client_wrapper";
import { PluginService } from "../../../plugin_service";
import { BlueGreenRole } from "../blue_green_role";
import { Messages } from "../../../utils/messages";
import { logger } from "../../../../logutils";
import { TelemetryFactory } from "../../../utils/telemetry/telemetry_factory";
import { TelemetryContext } from "../../../utils/telemetry/telemetry_context";
import { TelemetryTraceLevel } from "../../../utils/telemetry/telemetry_trace_level";
import { BlueGreenStatus } from "../blue_green_status";
import { convertMsToNanos, convertNanosToMs, getTimeInNanos, Pair } from "../../../utils/utils";
import { WrapperProperties } from "../../../wrapper_property";
import { BlueGreenPhase } from "../blue_green_phase";
import { TimeoutError } from "@opentelemetry/sdk-metrics";

export class SuspendUntilCorrespondingHostFoundConnectRouting extends BaseConnectRouting {
  protected static readonly TELEMETRY_SWITCHOVER: string = "Blue/Green switchover";
  private static readonly SLEEP_TIME_MS: number = 100;

  protected bgdId: string;

  constructor(hostAndPort: string, role: BlueGreenRole, bgdId: string) {
    super(hostAndPort, role);
    this.bgdId = bgdId;
  }

  async apply(
    plugin: ConnectionPlugin,
    hostInfo: HostInfo,
    properties: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>,
    pluginService: PluginService
  ): Promise<ClientWrapper> {
    logger.debug(Messages.get("bgd.waitConnectUntilCorrespondingHostFound", hostInfo.host));

    const telemetryFactory: TelemetryFactory = pluginService.getTelemetryFactory();
    const telemetryContext: TelemetryContext = telemetryFactory.openTelemetryContext(
      SuspendUntilCorrespondingHostFoundConnectRouting.TELEMETRY_SWITCHOVER,
      TelemetryTraceLevel.NESTED
    );

    return await telemetryContext.start(async () => {
      let bgStatus: BlueGreenStatus = pluginService.getStatus<BlueGreenStatus>(BlueGreenStatus, this.bgdId);
      let correspondingPair: Pair<HostInfo, HostInfo> = bgStatus?.correspondingHosts.get(hostInfo.host);

      const timeoutNanos: bigint = convertMsToNanos(WrapperProperties.BG_CONNECT_TIMEOUT.get(properties));
      const holdStartTime: bigint = getTimeInNanos();
      const endTime: bigint = getTimeInNanos() + timeoutNanos;

      while (
        getTimeInNanos() <= endTime &&
        !bgStatus &&
        bgStatus.currentPhase !== BlueGreenPhase.COMPLETED &&
        (!correspondingPair || !correspondingPair.right)
      ) {
        await this.delay(SuspendUntilCorrespondingHostFoundConnectRouting.SLEEP_TIME_MS, bgStatus, pluginService, this.bgdId);

        bgStatus = pluginService.getStatus<BlueGreenStatus>(BlueGreenStatus, this.bgdId);
        correspondingPair = bgStatus?.correspondingHosts.get(hostInfo.host);
      }

      if (!bgStatus && bgStatus.currentPhase !== BlueGreenPhase.COMPLETED) {
        logger.debug(Messages.get("bgd.completedContinueWithConnect", `${convertNanosToMs(getTimeInNanos() - holdStartTime)}`));
      } else if (getTimeInNanos() > endTime) {
        throw new TimeoutError(
          Messages.get("bgd.correspondingHosNotFoundTryConnectLater", hostInfo.host, `${WrapperProperties.BG_CONNECT_TIMEOUT.get(properties)}`)
        );
      }

      // returning no connection so the next routing can handle it
      return Promise.resolve();
    });
  }
}
