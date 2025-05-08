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

import { PluginService } from "../../plugin_service";
import { HostInfo } from "../../host_info";
import { RdsUtils } from "../../utils/rds_utils";
import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { ErrorSimulator } from "./error_simulator";
import { ErrorSimulatorMethodCallback } from "./error_simulator_method_callback";
import { ErrorSimulatorManager } from "./error_simulator_manager";
import { logger } from "../../../logutils";

export class DeveloperConnectionPlugin extends AbstractConnectionPlugin implements ErrorSimulator {
  static ALL_METHODS = "*";
  static readonly subscribedMethods = new Set<string>(DeveloperConnectionPlugin.ALL_METHODS);

  private errorSimulatorMethodCallback: ErrorSimulatorMethodCallback | null;
  private nextMethodName: string | null;
  private nextError: Error | null;
  pluginService: PluginService;
  properties: Map<string, any>;
  rdsUtils: RdsUtils;

  constructor(
    pluginService: PluginService,
    properties: Map<string, any>,
    rdsUtils: RdsUtils = new RdsUtils(),
    nextMethodName?: string,
    nextError?: Error,
    errorSimulatorMethodCallback?: ErrorSimulatorMethodCallback
  ) {
    super();
    this.pluginService = pluginService;
    this.properties = properties;
    this.rdsUtils = rdsUtils;
    this.nextMethodName = nextMethodName ?? null;
    this.nextError = nextError ?? null;
    this.errorSimulatorMethodCallback = errorSimulatorMethodCallback ?? null;
  }

  getSubscribedMethods(): Set<string> {
    return DeveloperConnectionPlugin.subscribedMethods;
  }

  raiseErrorOnNextCall(throwable: Error, methodName?: string): void {
    this.nextError = throwable;
    this.nextMethodName = methodName ?? DeveloperConnectionPlugin.ALL_METHODS;
  }

  setCallback(errorSimulatorMethodCallback: ErrorSimulatorMethodCallback): void {
    this.errorSimulatorMethodCallback = errorSimulatorMethodCallback;
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    this.raiseErrorIfNeeded(methodName, methodArgs);
    return methodFunc();
  }

  raiseErrorIfNeeded<T>(methodName: string, methodArgs: any[]) {
    if (this.nextError !== null) {
      if (DeveloperConnectionPlugin.ALL_METHODS === this.nextMethodName || methodName === this.nextMethodName) {
        this.raiseError(this.nextError, methodName);
      }
    } else if (this.errorSimulatorMethodCallback !== null) {
      this.raiseError(this.errorSimulatorMethodCallback?.getErrorToRaise(methodName, methodArgs), methodName);
    }
  }

  raiseError(throwable: Error | null, methodName: string) {
    if (throwable === null) {
      return;
    }

    this.nextError = null;
    this.nextMethodName = null;

    logger.debug(`Raised an error: ${throwable.name} while executing ${methodName}.`);

    throw throwable;
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    this.raiseErrorOnConnectIfNeeded(hostInfo, props, isInitialConnection);
    return connectFunc();
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    this.raiseErrorOnConnectIfNeeded(hostInfo, props, isInitialConnection);
    return forceConnectFunc();
  }

  raiseErrorOnConnectIfNeeded(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean) {
    if (ErrorSimulatorManager.nextError !== null) {
      this.raiseErrorOnConnect(ErrorSimulatorManager.nextError);
    } else if (ErrorSimulatorManager.connectCallback !== null) {
      this.raiseErrorOnConnect(ErrorSimulatorManager.connectCallback.getErrorToRaise(hostInfo, props, isInitialConnection));
    }
  }

  raiseErrorOnConnect(throwable: Error | null) {
    if (!throwable) {
      return;
    }

    ErrorSimulatorManager.nextError = null;

    logger.debug(`Raised an error: ${throwable.name} while opening a new connection.`);

    throw throwable;
  }
}
