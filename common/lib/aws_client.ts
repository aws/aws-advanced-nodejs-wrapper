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
import { PluginService, PluginServiceImpl } from "./plugin_service";
import { DatabaseDialect, DatabaseType } from "./database_dialect/database_dialect";
import { ConnectionUrlParser } from "./utils/connection_url_parser";
import { HostListProvider } from "./host_list_provider/host_list_provider";
import { PluginManager } from "./plugin_manager";

import pkgStream from "stream";
import { ClientWrapper } from "./client_wrapper";
import { ConnectionProviderManager } from "./connection_provider_manager";
import { DefaultTelemetryFactory } from "./utils/telemetry/default_telemetry_factory";
import { TelemetryFactory } from "./utils/telemetry/telemetry_factory";
import { DriverDialect } from "./driver_dialect/driver_dialect";
import { WrapperProperties } from "./wrapper_property";
import { DriverConfigurationProfiles } from "./profile/driver_configuration_profiles";
import { ConfigurationProfile } from "./profile/configuration_profile";
import { AwsWrapperError } from "./utils/errors";
import { Messages } from "./utils/messages";
import { TransactionIsolationLevel } from "./utils/transaction_isolation_level";
import { HostListProviderService } from "./host_list_provider_service";
import { SessionStateClient } from "./session_state_client";
import { ConnectionProvider } from "./connection_provider";

const { EventEmitter } = pkgStream;

export abstract class AwsClient extends EventEmitter implements SessionStateClient {
  private _defaultPort: number = -1;
  protected telemetryFactory: TelemetryFactory;
  protected pluginManager: PluginManager;
  protected pluginService: PluginService;
  protected isConnected: boolean = false;
  protected _connectionUrlParser: ConnectionUrlParser;
  protected _configurationProfile: ConfigurationProfile | null = null;
  readonly properties: Map<string, any>;
  config: any;
  targetClient?: ClientWrapper;

  protected constructor(
    config: any,
    dbType: DatabaseType,
    knownDialectsByCode: Map<string, DatabaseDialect>,
    parser: ConnectionUrlParser,
    driverDialect: DriverDialect,
    connectionProvider: ConnectionProvider
  ) {
    super();
    this.config = config;
    this._connectionUrlParser = parser;

    this.properties = new Map<string, any>(Object.entries(config));

    const profileName = WrapperProperties.PROFILE_NAME.get(this.properties);
    if (profileName && profileName.length > 0) {
      this._configurationProfile = DriverConfigurationProfiles.getProfileConfiguration(profileName);
      if (this._configurationProfile) {
        const profileProperties = this._configurationProfile.getProperties();
        if (profileProperties) {
          for (const key of profileProperties.keys()) {
            if (this.properties.has(key)) {
              // Setting defined by a user has priority over property in configuration profile.
              continue;
            }
            this.properties.set(key, profileProperties.get(key));
          }

          const connectionProvider = WrapperProperties.CONNECTION_PROVIDER.get(this.properties);
          if (!connectionProvider) {
            WrapperProperties.CONNECTION_PROVIDER.set(this.properties, this._configurationProfile.getAwsCredentialProvider());
          }

          const customAwsCredentialProvider = WrapperProperties.CUSTOM_AWS_CREDENTIAL_PROVIDER_HANDLER.get(this.properties);
          if (!customAwsCredentialProvider) {
            WrapperProperties.CUSTOM_AWS_CREDENTIAL_PROVIDER_HANDLER.set(this.properties, this._configurationProfile.getAwsCredentialProvider());
          }

          const customDatabaseDialect = WrapperProperties.CUSTOM_DATABASE_DIALECT.get(this.properties);
          if (!customDatabaseDialect) {
            WrapperProperties.CUSTOM_DATABASE_DIALECT.set(this.properties, this._configurationProfile.getDatabaseDialect());
          }
        }
      } else {
        throw new AwsWrapperError(Messages.get("AwsClient.configurationProfileNotFound", profileName));
      }
    }

    this.telemetryFactory = new DefaultTelemetryFactory(this.properties);
    const container = new PluginServiceManagerContainer();
    this.pluginService = new PluginServiceImpl(
      container,
      this,
      dbType,
      knownDialectsByCode,
      this.properties,
      this._configurationProfile?.getDriverDialect() ?? driverDialect
    );
    this.pluginManager = new PluginManager(
      container,
      this.properties,
      new ConnectionProviderManager(connectionProvider, WrapperProperties.CONNECTION_PROVIDER.get(this.properties)),
      this.telemetryFactory
    );
  }

  private async setup() {
    await this.telemetryFactory.init();
    await this.pluginManager.init(this._configurationProfile);
  }

  protected async internalConnect() {
    await this.setup();
    const hostListProvider: HostListProvider = this.pluginService
      .getDialect()
      .getHostListProvider(this.properties, this.properties.get("host"), <HostListProviderService>(<unknown>this.pluginService));
    this.pluginService.setHostListProvider(hostListProvider);
    await this.pluginService.refreshHostList();
    const initialHostInfo = this.pluginService.getInitialConnectionHostInfo();
    if (initialHostInfo != null) {
      await this.pluginManager.initHostProvider(initialHostInfo, this.properties, <HostListProviderService>(<unknown>this.pluginService));
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

  get connectionUrlParser(): ConnectionUrlParser {
    return this._connectionUrlParser;
  }

  abstract setReadOnly(readOnly: boolean): Promise<any | void>;

  abstract isReadOnly(): boolean;

  abstract setAutoCommit(autoCommit: boolean): Promise<any | void>;

  abstract getAutoCommit(): boolean;

  abstract setTransactionIsolation(level: TransactionIsolationLevel): Promise<any | void>;

  abstract getTransactionIsolation(): TransactionIsolationLevel;

  abstract setSchema(schema: any): Promise<any | void>;

  abstract getSchema(): string;

  abstract setCatalog(catalog: string): Promise<any | void>;

  abstract getCatalog(): string;

  abstract end(): Promise<any>;

  abstract connect(): Promise<any>;

  abstract rollback(): Promise<any>;

  unwrapPlugin<T>(iface: new (...args: any[]) => T): T | null {
    return this.pluginManager.unwrapPlugin(iface);
  }

  async isValid(): Promise<boolean> {
    if (!this.targetClient) {
      return Promise.resolve(false);
    }
    return await this.pluginService.isClientValid(this.targetClient);
  }

  getPluginInstance<T>(iface: any): T {
    return this.pluginManager.getPluginInstance(iface);
  }
}
