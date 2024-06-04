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
import { DatabaseDialect, DatabaseType } from "./database_dialect/database_dialect";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { PluginManager } from "./plugin_manager";
import { EventEmitter } from "stream";
import { DriverConnectionProvider } from "./driver_connection_provider";

export abstract class AwsClient extends EventEmitter {
  protected pluginManager: PluginManager;
  protected pluginService: PluginService;
  private _defaultPort: number = -1;
  private _config: any;
  protected isConnected: boolean = false;
  protected _isReadOnly: boolean = false;
  protected _isAutoCommit: boolean = true;
  protected _catalog: string = "";
  protected _schema: string = "";
  protected _isolationLevel: number = 0;
  private readonly _properties: Map<string, any>;
  private _targetClient: any = null;
  protected _errorHandler: ErrorHandler;
  protected _createClientFunc?: (config: any) => any;
  protected _connectFunc?: () => Promise<any>;
  protected _connectionUrlParser: ConnectionUrlParser;

  protected constructor(
    config: any,
    errorHandler: ErrorHandler,
    dbType: DatabaseType,
    knownDialectsByCode: Map<string, DatabaseDialect>,
    parser: ConnectionUrlParser
  ) {
    super();
    this._errorHandler = errorHandler;
    this._connectionUrlParser = parser;

    this._properties = new Map<string, any>(Object.entries(config));

    const defaultConnProvider = new DriverConnectionProvider();
    const effectiveConnProvider = null;
    // TODO: check for configuration profile to update the effectiveConnProvider

    const container = new PluginServiceManagerContainer();
    this.pluginService = new PluginService(container, this, dbType, knownDialectsByCode, this.properties);
    this.pluginManager = new PluginManager(container, this._properties, defaultConnProvider, effectiveConnProvider);

    // TODO: properly set up host info
    const host: string = this._properties.get("host");
    const port: number = this._properties.get("port");

    this.pluginService.setCurrentHostInfo(new HostInfo(host, port));
  }

  protected async internalConnect() {
    const hostListProvider: HostListProvider = this.pluginService
      .getDialect()
      .getHostListProvider(this._properties, this._properties.get("host"), this.pluginService);
    this.pluginService.setHostListProvider(hostListProvider);
    const info = this.pluginService.getCurrentHostInfo();
    if (info != null) {
      await this.pluginManager.initHostProvider(info, this.properties, this.pluginService);
    }
  }

  protected async internalPostConnect() {
    const info = this.pluginService.getCurrentHostInfo();
    if (info != null) {
      await this.pluginService.refreshHostList();
    }
    this.isConnected = true;
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

  get connectionUrlParser(): ConnectionUrlParser {
    return this._connectionUrlParser;
  }

  getCreateClientFunc<Type>(): ((config: any) => Type) | undefined {
    return this._createClientFunc;
  }

  abstract executeQuery(props: Map<string, any>, sql: string): Promise<any>;

  abstract setReadOnly(readOnly: boolean): Promise<any | void>;

  abstract isReadOnly(): boolean;

  abstract setAutoCommit(autoCommit: boolean): Promise<any | void>;

  abstract getAutoCommit(): boolean;

  abstract setTransactionIsolation(transactionIsolation: number): Promise<any | void>;

  abstract getTransactionIsolation(): number;

  abstract setSchema(schema: any): Promise<any | void>;

  abstract getSchema(): string;

  abstract setCatalog(catalog: string): Promise<any | void>;

  abstract getCatalog(): string;

  abstract end(): Promise<any>;

  abstract rollback(): Promise<any>;

  abstract resetState(): void;

  async isValid(): Promise<boolean> {
    if (!this.targetClient) {
      return Promise.resolve(false);
    }
    return await this.pluginService.getDialect().isClientValid(this.targetClient);
  }
}
