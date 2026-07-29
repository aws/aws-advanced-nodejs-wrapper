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

import { WrapperProperties } from "../../../wrapper_property";
import { ConnectionContext } from "../base/connection_context";
import { HostMonitorService, HostMonitorServiceImpl } from "../base/host_monitor_service";
import { HostMonitoringConnectionPlugin } from "../v1/host_monitoring_connection_plugin";
import { logger, uniqueId } from "../../../../logutils";
import { Messages } from "../../../utils/messages";
import { SubscribedMethodHelper } from "../../../utils/subscribed_method_helper";
import { FullServicesContainer } from "../../../utils/full_services_container";

export class HostMonitoring2ConnectionPlugin extends HostMonitoringConnectionPlugin {
  id: string = uniqueId("_efm2Plugin");

  constructor(servicesContainer: FullServicesContainer, properties: Map<string, any>, monitorService?: HostMonitorService) {
    super(servicesContainer, properties, monitorService ?? new HostMonitorServiceImpl(servicesContainer));
  }

  async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any): Promise<T> {
    const isEnabled: boolean = WrapperProperties.FAILURE_DETECTION_ENABLED.get(this.properties);

    if (!isEnabled || !SubscribedMethodHelper.NETWORK_BOUND_METHODS.includes(methodName)) {
      return methodFunc();
    }

    const failureDetectionTimeMillis: number = WrapperProperties.FAILURE_DETECTION_TIME_MS.get(this.properties);
    const failureDetectionIntervalMillis: number = WrapperProperties.FAILURE_DETECTION_INTERVAL_MS.get(this.properties);
    const failureDetectionCount: number = WrapperProperties.FAILURE_DETECTION_COUNT.get(this.properties);

    let result: T;
    let context: ConnectionContext | null = null;

    try {
      logger.debug(Messages.get("HostMonitoringConnectionPlugin.activatedMonitoring", methodName));
      const monitoringHostInfo = await this.getMonitoringHostInfo();

      context = await this.monitorService.startMonitoring(
        this.pluginService.getCurrentClient().targetClient,
        monitoringHostInfo,
        this.properties,
        failureDetectionTimeMillis,
        failureDetectionIntervalMillis,
        failureDetectionCount
      );

      result = await methodFunc();
    } finally {
      if (context != null) {
        this.monitorService.stopMonitoring(context);
        logger.debug(Messages.get("HostMonitoringConnectionPlugin.monitoringDeactivated", methodName));
      }
    }

    return result;
  }
}
