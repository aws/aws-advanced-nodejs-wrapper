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
import { ErrorHandler } from "./error_handler";
import { DatabaseDialect, DatabaseType } from "./database_dialect/database_dialect";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { PluginManager } from "./plugin_manager";
import { EventEmitter } from "stream";
import { DriverConnectionProvider } from "./driver_connection_provider";
import { ClientWrapper } from "./client_wrapper";
import { DefaultTelemetryFactory } from "./utils/telemetry/default_telemetry_factory";
import { TelemetryFactory } from "./utils/telemetry/telemetry_factory";

export abstract class AwsClient extends EventEmitter {
  private _defaultPort: number = -1;
  protected telemetryFactory: TelemetryFactory;
  protected pluginManager: PluginManager;
  protected pluginService: PluginService;
  protected isConnected: boolean = false;
  protected _isReadOnly: boolean = false;
  protected _isAutoCommit: boolean = true;
  protected _catalog: string = "";
  protected _schema: string = "";
  protected _isolationLevel: number = 0;
  protected _errorHandler: ErrorHandler;
  protected _createClientFunc?: (config: any) => any;
  protected _connectionUrlParser: ConnectionUrlParser;
  readonly properties: Map<string, any>;
  config: any;
  targetClient?: ClientWrapper;

  protected constructor(
    config: any,
    errorHandler: ErrorHandler,
    dbType: DatabaseType,
    knownDialectsByCode: Map<string, DatabaseDialect>,
    parser: ConnectionUrlParser
  ) {
    super();
    this.config = config;
    this._errorHandler = errorHandler;
    this._connectionUrlParser = parser;

    this.properties = new Map<string, any>(Object.entries(config));

    const defaultConnProvider = new DriverConnectionProvider();
    const effectiveConnProvider = null;
    // TODO: check for configuration profile to update the effectiveConnProvider

    this.telemetryFactory = new DefaultTelemetryFactory(this.properties);

    const container = new PluginServiceManagerContainer();
    this.pluginService = new PluginService(container, this, dbType, knownDialectsByCode, this.properties);
    this.pluginManager = new PluginManager(container, this.properties, defaultConnProvider, effectiveConnProvider, this.telemetryFactory);
  }

  private async setup() {
    await this.telemetryFactory.init();
    await this.pluginManager.init();
  }

  protected async internalConnect() {
    await this.setup();
    const hostListProvider: HostListProvider = this.pluginService
      .getDialect()
      .getHostListProvider(this.properties, this.properties.get("host"), this.pluginService);
    this.pluginService.setHostListProvider(hostListProvider);
    await this.pluginService.refreshHostList();
    const initialHostInfo = this.pluginService.getInitialConnectionHostInfo();
    if (initialHostInfo != null) {
      await this.pluginManager.initHostProvider(initialHostInfo, this.properties, this.pluginService);
      await this.pluginService.refreshHostList();
    }
  }

  protected async internalPostConnect() {
    const info = this.pluginService.getCurrentHostInfo();
    if (info != null) {
      await this.pluginService.refreshHostList();
    }

    this.isConnected = true;
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

  abstract updateSessionStateReadOnly(readOnly: boolean): Promise<any | void>;

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

  abstract connect(): Promise<any>;

  abstract rollback(): Promise<any>;

  abstract resetState(): void;

  async isValid(): Promise<boolean> {
    if (!this.targetClient) {
      return Promise.resolve(false);
    }
    return await this.pluginService.isClientValid(this.targetClient);
  }

  async releaseResources(): Promise<any> {
    await this.pluginManager.releaseResources();
  }

  abstract executeQuery(props: Map<string, any>, query: string, targetClient?: ClientWrapper): any;
}
