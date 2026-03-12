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
import { sleepWithAbort } from "../../../utils/utils";
import { logger } from "../../../../logutils";
import { Messages } from "../../../utils/messages";
import { TelemetryTraceLevel } from "../../../utils/telemetry/telemetry_trace_level";
import { ClientWrapper } from "../../../client_wrapper";
import { WrapperProperties } from "../../../wrapper_property";
import { AbstractMonitor } from "../../../utils/monitoring/monitor";
import { FullServicesContainer } from "../../../utils/full_services_container";

export class ResponseTimeHolder {
  private readonly url: string;
  private readonly responseTime: number;

  constructor(url: string, responseTime: number) {
    this.url = url;
    this.responseTime = responseTime;
  }

  getUrl(): string {
    return this.url;
  }

  getResponseTime(): number {
    return this.responseTime;
  }
}

export class HostResponseTimeMonitor extends AbstractMonitor {
  static readonly NUM_OF_MEASURES = 5;
  private static readonly TERMINATION_TIMEOUT_SEC = 5;
  private readonly intervalMs: number;
  private readonly hostInfo: HostInfo;
  private responseTimeMs = Number.MAX_SAFE_INTEGER;

  private readonly properties: Map<string, any>;
  private readonly servicesContainer: FullServicesContainer;
  private readonly pluginService: PluginService;
  private readonly telemetryFactory: TelemetryFactory;
  protected monitoringClient: ClientWrapper | null = null;
  private abortSleep?: () => void;

  constructor(servicesContainer: FullServicesContainer, hostInfo: HostInfo, properties: Map<string, any>, intervalMs: number) {
    super(HostResponseTimeMonitor.TERMINATION_TIMEOUT_SEC);
    this.servicesContainer = servicesContainer;
    this.pluginService = servicesContainer.pluginService;
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.intervalMs = intervalMs;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();

    const hostId: string = this.hostInfo.hostId ?? this.hostInfo.host;
    this.telemetryFactory.createGauge(`frt.response.time.${hostId}`, () =>
      this.responseTimeMs === Number.MAX_SAFE_INTEGER ? -1 : this.responseTimeMs
    );
  }

  getResponseTime(): number {
    return this.responseTimeMs;
  }

  getHostInfo(): HostInfo {
    return this.hostInfo;
  }

  async close(): Promise<void> {
    if (this.abortSleep) {
      try {
        this.abortSleep();
      } catch (error) {
        // ignore
      }
      this.abortSleep = undefined;
    }
    if (this.monitoringClient) {
      try {
        await this.monitoringClient.abort();
      } catch (error) {
        // ignore
      }
      this.monitoringClient = null;
    }
  }

  async monitor(): Promise<void> {
    const telemetryContext = this.telemetryFactory.openTelemetryContext("host response time task", TelemetryTraceLevel.TOP_LEVEL);
    telemetryContext.setAttribute("url", this.hostInfo.host);

    while (!this._stop) {
      this.lastActivityTimestampNanos = BigInt(Date.now() * 1_000_000);
      await telemetryContext.start(async () => {
        try {
          await this.openConnection();
          if (this.monitoringClient) {
            let responseTimeSum = 0;
            let count = 0;
            for (let i = 0; i < HostResponseTimeMonitor.NUM_OF_MEASURES; i++) {
              if (this._stop) {
                break;
              }
              const startTime = Date.now();
              if (await this.pluginService.isClientValid(this.monitoringClient)) {
                responseTimeSum += Date.now() - startTime;
                count++;
              }
            }
            if (count > 0) {
              this.responseTimeMs = responseTimeSum / count;
              this.servicesContainer.storageService.set(this.hostInfo.url, new ResponseTimeHolder(this.hostInfo.url, this.responseTimeMs));
            } else {
              this.responseTimeMs = Number.MAX_SAFE_INTEGER;
              this.servicesContainer.storageService.remove(ResponseTimeHolder, this.hostInfo.url);
            }
            logger.debug(Messages.get("HostResponseTimeMonitor.responseTime", this.hostInfo.host, this.responseTimeMs.toString()));
          }
          const [sleepPromise, abortFn] = sleepWithAbort(this.intervalMs);
          this.abortSleep = abortFn as () => void;
          await sleepPromise;
        } catch (error) {
          logger.debug(Messages.get("HostResponseTimeMonitor.interruptedErrorDuringMonitoring", this.hostInfo.host, error.message));
        }
      });
    }
  }

  async openConnection(): Promise<void> {
    try {
      if (this.monitoringClient) {
        if (await this.pluginService.isClientValid(this.monitoringClient)) {
          return;
        }
      }
      const monitoringConnProperties: Map<string, any> = new Map(this.properties);
      for (const key of monitoringConnProperties.keys()) {
        if (!key.startsWith(WrapperProperties.MONITORING_PROPERTY_PREFIX)) {
          continue;
        }
        monitoringConnProperties.set(key.substring(WrapperProperties.MONITORING_PROPERTY_PREFIX.length), this.properties.get(key));
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
