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

import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { logger } from '../../logutils';
import { HostInfo } from "../host_info";
import { getTimeInNanos } from '../utils/utils';
import { Messages } from "../utils/messages";
import { ConnectionPluginFactory } from "../plugin_factory";
import { ConnectionPlugin } from "../connection_plugin";
import { PluginService } from '../plugin_service';

export class ConnectTimePlugin extends AbstractConnectionPlugin {
  private static readonly subscribedMethods: Set<string> = new Set<string>(["connect", "forceConnect"]);
  private static connectTime: bigint = 0n;

  public override getSubscribedMethods(): Set<string> {
    return ConnectTimePlugin.subscribedMethods;
  }

  public override async connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    const startTime = getTimeInNanos();
    
    const result = await connectFunc();

    const elapsedTimeNanos = getTimeInNanos() - startTime;
    ConnectTimePlugin.connectTime += elapsedTimeNanos;
    logger.debug(Messages.get("ConnectTimePlugin.connectTime", hostInfo.host, elapsedTimeNanos.toString()));
    return result;
  }

  public override async forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    const startTime = getTimeInNanos();

    const result = await forceConnectFunc();

    const elapsedTimeNanos = getTimeInNanos() - startTime;
    ConnectTimePlugin.connectTime += elapsedTimeNanos;
    logger.debug(Messages.get("ConnectTimePlugin.connectTime", hostInfo.host, elapsedTimeNanos.toString()));
    return result;
  }

  public static resetConnectTime(): void {
    ConnectTimePlugin.connectTime = 0n;
  }

  public static getTotalConnectTime(): bigint {
    return ConnectTimePlugin.connectTime;
  }
}

export class ConnectTimePluginFactory implements ConnectionPluginFactory {
  getInstance(pluginService: PluginService, properties: Map<string, any>): ConnectionPlugin {
    return new ConnectTimePlugin();
  }
}
