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

import { HostInfo } from "../../../host_info";
import { PluginService } from "../../../plugin_service";
import { TelemetryFactory } from "../../../utils/telemetry/telemetry_factory";
import { sleep } from "../../../utils/utils";
import { logger } from "../../../../logutils";
import { Messages } from "../../../utils/messages";
import { TelemetryTraceLevel } from "../../../utils/telemetry/telemetry_trace_level";
import { ClientWrapper } from "../../../client_wrapper";
import { TelemetryContext } from "../../../utils/telemetry/telemetry_context";
import { WrapperProperties } from "../../../wrapper_property";

export class HostResponseTimeMonitor {
  static readonly MONITORING_PROPERTY_PREFIX = "frt_";
  static readonly NUM_OF_MEASURES = 5;
  private readonly intervalMs: number;
  private readonly hostInfo: HostInfo;
  private stopped = false;
  private responseTimeMs = Number.MAX_SAFE_INTEGER;
  private checkTimestamp = Date.now();

  private readonly properties: Map<string, any>;
  private pluginService: PluginService;
  private telemetryFactory: TelemetryFactory;
  protected monitoringClient: ClientWrapper | null = null;

  constructor(pluginService: PluginService, hostInfo: HostInfo, properties: Map<string, any>, intervalMs: number) {
    this.pluginService = pluginService;
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.intervalMs = intervalMs;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();

    const hostId: string = this.hostInfo.hostId ?? this.getHostInfo().host;
    /**
     * Report current response time (in milliseconds) to telemetry engine.
     * Report -1 if response time couldn't be measured.
     */
    this.telemetryFactory.createGauge(`frt.response.time.${hostId}`, () => this.getResponseTime() == Number.MAX_SAFE_INTEGER);
    this.run();
  }

  getResponseTime() {
    return this.responseTimeMs;
  }

  getCheckTimeStamp() {
    return this.checkTimestamp;
  }

  getHostInfo() {
    return this.hostInfo;
  }

  async close(): Promise<void> {
    this.stopped = true;
    await sleep(500);
    logger.debug(Messages.get("HostResponseTimeMonitor.stopped", this.hostInfo.host));
  }

  async run(): Promise<void> {
    const telemetryContext: TelemetryContext = this.telemetryFactory.openTelemetryContext("host response time task", TelemetryTraceLevel.TOP_LEVEL);
    telemetryContext.setAttribute("url", this.hostInfo.host);
    while (!this.stopped) {
      await telemetryContext.start(async () => {
        try {
          await this.openConnection();
          if (this.monitoringClient) {
            let responseTimeSum = 0;
            let count = 0;
            for (let i = 0; i < HostResponseTimeMonitor.NUM_OF_MEASURES; i++) {
              if (this.stopped) {
                break;
              }
              const startTime = Date.now();
              if (await this.pluginService.isClientValid(this.monitoringClient)) {
                const responseTime = Date.now() - startTime;
                responseTimeSum += responseTime;
                count++;
              }
            }
            if (count > 0) {
              this.responseTimeMs = responseTimeSum / count;
            } else {
              this.responseTimeMs = Number.MAX_SAFE_INTEGER;
            }
            this.checkTimestamp = Date.now();
            logger.debug(Messages.get("HostResponseTimeMonitor.responseTime", this.hostInfo.host, this.responseTimeMs.toString()));
          }
          await sleep(this.intervalMs);
        } catch (error) {
          logger.debug(Messages.get("HostResponseTimeMonitor.interruptedErrorDuringMonitoring", this.hostInfo.host, error.message));
        } finally {
          this.stopped = true;
          if (this.monitoringClient) {
            await this.monitoringClient.abort();
          }
          this.monitoringClient = null;
        }
      });
    }
  }

  async openConnection(): Promise<void> {
    try {
      if (this.monitoringClient) {
        const clientIsValid = await this.pluginService.isClientValid(this.monitoringClient);
        if (clientIsValid) {
          return;
        }
      }
      const monitoringConnProperties: Map<string, any> = new Map(this.properties);
      for (const key of monitoringConnProperties.keys()) {
        if (!key.startsWith(WrapperProperties.MONITORING_PROPERTY_PREFIX)) {
          continue;
        }
        monitoringConnProperties.set(key.substring(HostResponseTimeMonitor.MONITORING_PROPERTY_PREFIX.length), this.properties.get(key));
        monitoringConnProperties.delete(key);
      }
      logger.debug(Messages.get("HostResponseTimeMonitor.openingConnection", this.hostInfo.url));
      this.monitoringClient = await this.pluginService.forceConnect(this.hostInfo, monitoringConnProperties);
      logger.debug(Messages.get("HostResponseTimeMonitor.openedConnection", this.hostInfo.url));
    } catch (e) {
      if (this.monitoringClient) {
        await this.monitoringClient.abort();
      }
      this.monitoringClient = null;
    }
  }
}
