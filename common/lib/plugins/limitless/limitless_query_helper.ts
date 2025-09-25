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
import { PluginService } from "../../plugin_service";
import { ClientWrapper } from "../../client_wrapper";
import { LimitlessDatabaseDialect } from "../../database_dialect/limitless_database_dialect";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { HostRole } from "../../host_role";
import { HostAvailability } from "../../host_availability/host_availability";
import { AwsWrapperError } from "../../utils/errors";
import { LimitlessHelper } from "./limitless_helper";

export class LimitlessQueryHelper {
  async queryForLimitlessRouters(pluginService: PluginService, targetClient: ClientWrapper, hostInfo: HostInfo): Promise<HostInfo[]> {
    if (!LimitlessHelper.isLimitlessDatabaseDialect(pluginService.getDialect())) {
      throw new AwsWrapperError(Messages.get("LimitlessQueryHelper.unsupportedDialectOrDatabase", pluginService.getDialect().getDialectName()));
    }

    const query = (pluginService.getDialect() as any as LimitlessDatabaseDialect).getLimitlessRoutersQuery();
    const res = await targetClient.client.query(query);
    const hosts: HostInfo[] = [];
    const rows: any[] = res.rows;
    rows.forEach((row) => {
      hosts.push(this.createHost(pluginService, row, hostInfo));
    });
    return Promise.resolve(hosts);
  }

  private createHost(pluginService: PluginService, row: any, hostInfo: HostInfo): HostInfo {
    const hostName: string = row["router_endpoint"];
    const cpu: number = row["load"];

    let weight: number = 10 - Math.floor(cpu * 10);

    if (weight < 1 || weight > 10) {
      weight = 1; // default to 1
      logger.warn(Messages.get("LimitlessQueryHelper.invalidRouterLoad", cpu.toString(), hostName));
    }

    return pluginService
      .getHostInfoBuilder()
      .withHost(hostName)
      .withPort(hostInfo.port)
      .withRole(HostRole.WRITER)
      .withAvailability(HostAvailability.AVAILABLE)
      .withWeight(weight)
      .withHostId(hostName)
      .build();
  }
}
