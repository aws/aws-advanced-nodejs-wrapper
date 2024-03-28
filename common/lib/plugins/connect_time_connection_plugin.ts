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

export class ConnectTimeConnectionPlugin extends AbstractConnectionPlugin {
    private static subscribedMethods: Set<string> = new Set<string>(["connect", "forceConnect"]);
    private static connectTime: number = 0;
    private pluginService: PluginService;

    constructor(PluginService: PluginService) {
        super();
        this.pluginService = PluginService;
    }

    override getSubscribedMethods(): Set<string> {
        return ConnectTimeConnectionPlugin.subscribedMethods;
    }

    override connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
        let startTime = getTimeInNanos();
        
        let result = connectFunc();

        let elapsedTimeNanos = Number(getTimeInNanos()) - Number(startTime);
        ConnectTimeConnectionPlugin.connectTime += elapsedTimeNanos;
        console.log(elapsedTimeNanos);
        logger.debug(Messages.get("ConnectTimeConnectionPlugin.connectTime", elapsedTimeNanos.toString()));
        return result;
    }

    override forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
        let startTime = getTimeInNanos();

        let result = forceConnectFunc();

        let elapsedTimeNanos = Number(getTimeInNanos()) - Number(startTime);
        ConnectTimeConnectionPlugin.connectTime += elapsedTimeNanos;
        logger.debug(Messages.get("ConnectTimeConnectionPlugin.connectTime", elapsedTimeNanos.toString()));
        return result;
    }

    public resetConnectTime(): void {
        ConnectTimeConnectionPlugin.connectTime = 0;
    }

    public getTotalConnectTime(): number {
        return ConnectTimeConnectionPlugin.connectTime;
    }
}

export class ConnectTimeConnectionPluginFactory implements ConnectionPluginFactory {
    getInstance(pluginService: PluginService, properties: Map<string, any>): ConnectionPlugin {
        return new ConnectTimeConnectionPlugin(pluginService);
    }
}