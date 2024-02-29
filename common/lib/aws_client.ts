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

import { PluginServiceManagerContainer } from "./plugin_service_manager_container";
import { PluginService } from "./plugin_service";
import { HostInfo } from "./host_info";
import { WrapperProperties } from "./wrapper_property";
import { ErrorHandler } from "./error_handler";
import { DatabaseDialect } from "./database_dialect";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { PluginManager } from "./plugin_manager";

export abstract class AwsClient {
  protected pluginManager: PluginManager;
  protected pluginService: PluginService;
  private _defaultPort: number = -1;
  private _config: any;
  protected isConnected: boolean = false;
  private readonly _properties: Map<string, any>;
  private _targetClient: any;
  protected _errorHandler: ErrorHandler;
  protected _dialect: DatabaseDialect;
  protected _createClientFunc?: (config: any) => any;
  protected _connectFunc?: () => Promise<any>;
  protected _connectionUrlParser: ConnectionUrlParser;

  protected constructor(config: any, errorHandler: ErrorHandler, dialect: DatabaseDialect, parser: ConnectionUrlParser) {
    this._errorHandler = errorHandler;
    this._connectionUrlParser = parser;

    this._dialect = dialect;
    this._properties = new Map<string, any>(Object.entries(config));

    const container = new PluginServiceManagerContainer();
    this.pluginService = new PluginService(container, this);
    this.pluginManager = new PluginManager(container, this.properties);

    // TODO: properly set up host info
    const host: string = this._properties.get("host");
    const port: number = this._properties.get("port");

    this.pluginService.setCurrentHostInfo(new HostInfo(host, port));
  }

  protected async internalConnect() {
    const hostListProvider: HostListProvider = this.dialect.getHostListProvider(this._properties, this._properties.get("host"), this.pluginService);
    this.pluginService.setHostListProvider(hostListProvider);

    const info = this.pluginService.getCurrentHostInfo();
    if (info != null) {
      await this.pluginManager.initHostProvider(info, this.properties, this.pluginService);
      await this.pluginService.refreshHostList();
    }
  }

  get properties(): Map<string, any> {
    return this._properties;
  }

  get config(): any {
    return this._config;
  }

  set config(value: any) {
    this._config = value;
  }

  get targetClient(): any {
    return this._targetClient;
  }

  set targetClient(value: any) {
    this._targetClient = value;
  }

  get defaultPort(): number {
    return this._defaultPort;
  }

  get errorHandler(): ErrorHandler {
    return this._errorHandler;
  }

  get dialect(): DatabaseDialect {
    return this._dialect;
  }

  get connectionUrlParser(): ConnectionUrlParser {
    return this._connectionUrlParser;
  }

  getCreateClientFunc<Type>(): ((config: any) => Type) | undefined {
    return this._createClientFunc;
  }

  getConnectFunc<Type>(): (() => Promise<Type>) | undefined {
    return this._connectFunc;
  }

  updateCredentials(properties: Map<string, any>): void {
    const user = WrapperProperties.USER.get(properties);
    const pass = WrapperProperties.PASSWORD.get(properties);

    if (this.targetClient.user != user) {
      this.targetClient.user = user;
    }

    if (this.targetClient.password != pass) {
      this.targetClient.password = pass;
    }
  }

  abstract executeQuery(props: Map<string, any>, sql: string): Promise<any>;

  abstract end(): Promise<any>;

  abstract isValid(): boolean;
}
