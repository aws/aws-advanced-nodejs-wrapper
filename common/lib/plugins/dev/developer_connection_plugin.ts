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
import { logger } from "../../../logutils";
import { ErrorSimulator } from "./error_simulator";
import { ErrorSimulatorExecuteJdbcMethodCallback } from "./error_simulator_execute_jdbc_method_callback";
import { ErrorSimulatorManager } from "./error_simulator_manager";

export class DeveloperConnectionPlugin extends AbstractConnectionPlugin implements ErrorSimulator {
  static ALL_METHODS = "*";
  static readonly subscribedMethods = new Set(DeveloperConnectionPlugin.ALL_METHODS);

  private errorSimulatorExecuteJdbcMethodCallback: ErrorSimulatorExecuteJdbcMethodCallback | null;
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
    errorSimulatorExecuteJdbcMethodCallback?: ErrorSimulatorExecuteJdbcMethodCallback
  ) {
    super();
    this.pluginService = pluginService;
    this.properties = properties;
    this.rdsUtils = rdsUtils;
    this.nextMethodName = nextMethodName ?? null;
    this.nextError = nextError ?? null;
    this.errorSimulatorExecuteJdbcMethodCallback = errorSimulatorExecuteJdbcMethodCallback ?? null;
  }

  getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);
  }

  raiseErrorOnNextCall(throwable: Error, methodName?: string): void {
    this.nextError = throwable;
    this.nextMethodName = methodName ?? DeveloperConnectionPlugin.ALL_METHODS;
  }

  setCallback(errorSimulatorExecuteJdbcMethodCallback: ErrorSimulatorExecuteJdbcMethodCallback): void {
    this.errorSimulatorExecuteJdbcMethodCallback = errorSimulatorExecuteJdbcMethodCallback;
  }

  async execute<T>(
    methodName: string,
    methodFunc: () => Promise<T>,
    methodArgs: any[],
    resultClass?: T,
    errorClass?: Error,
    methodInvokeOn?: object
  ): Promise<T> {
    if (resultClass && errorClass && resultClass !== undefined && errorClass !== undefined) {
      this.raiseErrorIfNeeded(resultClass, errorClass, methodName, methodArgs);
      return methodFunc();
    }
    throw new Error("Result class and Error class should be defined.");
  }

  raiseErrorIfNeeded<T>(resultClass: T, errorClass: Error | undefined, methodName: string, methodArgs: any[]) {
    if (this.nextError != null) {
      if (DeveloperConnectionPlugin.ALL_METHODS == this.nextMethodName || methodName == this.nextMethodName) {
        this.raiseError(errorClass, this.nextError, methodName);
      }
    } else if (this.errorSimulatorExecuteJdbcMethodCallback != null) {
      this.raiseError(
        errorClass,
        this.errorSimulatorExecuteJdbcMethodCallback?.getErrorToRaise(resultClass, errorClass, methodName, methodArgs),
        methodName
      );
    }
  }

  raiseError(errorClass: Error | undefined, throwable: Error, methodName: string) {
    if (throwable == null) {
      return;
    }

    this.nextError = null;
    this.nextMethodName = null;

    logger.debug("Raise an error " + typeof throwable + "while executing " + methodName) + ".";

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
    if (ErrorSimulatorManager.nextError != null) {
      this.raiseErrorOnConnect(ErrorSimulatorManager.nextError);
    } else if (ErrorSimulatorManager.connectCallback != null) {
      this.raiseErrorOnConnect(ErrorSimulatorManager.connectCallback.getErrorToRaise(hostInfo, props, isInitialConnection));
    }
  }

  raiseErrorOnConnect(throwable: Error|null) {
    if (throwable == null) {
      return;
    }

    ErrorSimulatorManager.nextError = null;

    logger.debug("Raise an error " + typeof throwable + "while opening a new connection.");

    throw throwable;
  }
}