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

import { HostInfo } from "../../host_info";
import { HostRole } from "../../host_role";
import { PluginService } from "../../plugin_service";
import { WrapperProperties } from "../../wrapper_property";
import { ClientWrapper } from "../../client_wrapper";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import {
  AbstractMonitoringConnectionHandler,
  MonitoringConnectionPriority,
  parseMonitoringConnectionPriorities
} from "./monitoring_connection_handler";

export class AuroraMonitoringConnectionHandler extends AbstractMonitoringConnectionHandler<MonitoringConnectionPriority> {
  private readonly writerPriorityIndex: number;
  private readonly readerPriorityIndex: number;

  constructor(
    pluginService: PluginService,
    monitoringProperties: Map<string, any>,
    getMonitoringClient: () => ClientWrapper | null,
    setMonitoringClient: (client: ClientWrapper | null) => void
  ) {
    const priorities = parseMonitoringConnectionPriorities(WrapperProperties.MONITORING_CONNECTION_PRIORITY.get(monitoringProperties));
    super(pluginService, monitoringProperties, priorities, getMonitoringClient, setMonitoringClient);
    this.writerPriorityIndex = this.computeIndex(true);
    this.readerPriorityIndex = this.computeIndex(false);
    logger.debug(Messages.get("AuroraMonitoringConnectionHandler.initialized", this.priorities.join(",")));
  }

  private computeIndex(isWriter: boolean): number {
    for (let i = 0; i < this.priorities.length; i++) {
      if (this.isSatisfiedBy(this.priorities[i], isWriter)) {
        return i;
      }
    }
    return this.priorities.length;
  }

  private isSatisfiedBy(priority: MonitoringConnectionPriority, isWriter: boolean): boolean {
    switch (priority) {
      case MonitoringConnectionPriority.STRICT_WRITER:
        return isWriter;
      case MonitoringConnectionPriority.STRICT_READER:
        return !isWriter;
      case MonitoringConnectionPriority.WRITER_OR_READER:
        return true;
      default:
        return false;
    }
  }

  protected getPriorityIndex(_hostInfo: HostInfo, isWriter: boolean): number {
    return isWriter ? this.writerPriorityIndex : this.readerPriorityIndex;
  }

  protected findHostsForPriority(priorityIndex: number, candidates: HostInfo[]): HostInfo[] {
    const priority = this.priorities[priorityIndex];
    if (!priority) {
      return [];
    }
    switch (priority) {
      case MonitoringConnectionPriority.STRICT_WRITER:
        return candidates.filter((h) => h.role === HostRole.WRITER);
      case MonitoringConnectionPriority.STRICT_READER:
        return candidates.filter((h) => h.role === HostRole.READER);
      case MonitoringConnectionPriority.WRITER_OR_READER: {
        const writers = candidates.filter((h) => h.role === HostRole.WRITER);
        return writers.length > 0 ? writers : candidates.filter((h) => h.role === HostRole.READER);
      }
      default:
        return [];
    }
  }
}
