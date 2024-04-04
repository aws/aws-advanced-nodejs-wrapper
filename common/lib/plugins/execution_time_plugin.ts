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

import { logger } from "../../logutils";
import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { ConnectionPlugin } from "../connection_plugin";
import { ConnectionPluginFactory } from "../plugin_factory";
import { PluginService } from "../plugin_service";
import { Messages } from "../utils/messages";
import { getTimeInNanos } from "../utils/utils";

export class ExecutionTimePlugin extends AbstractConnectionPlugin {
  private static readonly subscribedMethods: Set<string> = new Set<string>(["*"]);
  private static executionTime: bigint = 0n;
  
  public override getSubscribedMethods(): Set<string> {
    return ExecutionTimePlugin.subscribedMethods;
  }

  public override async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    const startTime = getTimeInNanos();

    const result = await methodFunc();

    const elapsedTimeNanos = getTimeInNanos() - startTime;
    
    // Convert from ns to ms
    logger.debug(Messages.get("ExecutionTimePlugin.executionTime", methodName, (elapsedTimeNanos / 1000000n).toString()));
    ExecutionTimePlugin.executionTime += elapsedTimeNanos;
    return result;
  }

  public static resetExecutionTime(): void {
    ExecutionTimePlugin.executionTime = 0n;
  }

  public static getTotalExecutionTime(): bigint {
    return ExecutionTimePlugin.executionTime;
  }
}

export class ExecutionTimePluginFactory implements ConnectionPluginFactory {
  getInstance(pluginService: PluginService, properties: Map<string, any>): ConnectionPlugin {
    return new ExecutionTimePlugin();
  }
}
