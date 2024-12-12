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

import { ConnectionPluginFactory } from "../plugin_factory";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { DriverDialect } from "../driver_dialect/driver_dialect";
import { ConnectionProvider } from "../connection_provider";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";
import { ConfigurationProfile } from "./configuration_profile";
import { ConfigurationProfilePresetCodes } from "./configuration_profile_codes";
import { DriverConfigurationProfiles } from "./driver_configuration_profiles";

export class ConfigurationProfileBuilder {
  protected name: string = null;
  protected pluginFactories: (typeof ConnectionPluginFactory)[] = null;
  protected properties: Map<string, any> = null;
  protected databaseDialect: DatabaseDialect | (() => DatabaseDialect) = null;
  protected driverDialect: DriverDialect | (() => DriverDialect) = null;
  protected awsCredentialProvider: any | null = null; //AwsCredentialsProviderHandler
  protected connectionProvider: ConnectionProvider | (() => ConnectionProvider) = null;

  private constructor() {}

  public static get(): ConfigurationProfileBuilder {
    return new ConfigurationProfileBuilder();
  }

  public withName(name: string): ConfigurationProfileBuilder {
    this.name = name;
    return this;
  }

  public withProperties(properties: Map<string, any>): ConfigurationProfileBuilder {
    this.properties = properties;
    return this;
  }

  public withPluginsFactories(pluginFactories: (typeof ConnectionPluginFactory)[]): ConfigurationProfileBuilder {
    this.pluginFactories = pluginFactories;
    return this;
  }

  public withDatabaseDialect(databaseDialect: DatabaseDialect): ConfigurationProfileBuilder {
    this.databaseDialect = databaseDialect;
    return this;
  }

  public withDriverDialect(driverDialect: DriverDialect): ConfigurationProfileBuilder {
    this.driverDialect = driverDialect;
    return this;
  }

  public withConnectionProvider(connectionProvider: ConnectionProvider): ConfigurationProfileBuilder {
    this.connectionProvider = connectionProvider;
    return this;
  }

  public withAwsCredentialProvider(awsCredentialProvider: any): ConfigurationProfileBuilder {
    this.awsCredentialProvider = awsCredentialProvider;
    return this;
  }

  public from(presetProfileName: string): ConfigurationProfileBuilder {
    const configurationProfile = DriverConfigurationProfiles.getProfileConfiguration(presetProfileName);
    if (!configurationProfile) {
      throw new AwsWrapperError(Messages.get("ConfigurationProfileBuilder.notFound", presetProfileName));
    }

    this.name = configurationProfile.getName();
    this.properties = configurationProfile.getProperties();
    this.databaseDialect = configurationProfile.getDatabaseDialect();
    this.driverDialect = configurationProfile.getDriverDialect();
    this.awsCredentialProvider = configurationProfile.getAwsCredentialProvider();
    this.connectionProvider = configurationProfile.getConnectionProvider();
    this.pluginFactories = configurationProfile.getPluginFactories();

    return this;
  }

  public build(): ConfigurationProfile {
    if (!this.name || this.name.length === 0) {
      throw new AwsWrapperError(Messages.get("ConfigurationProfileBuilder.profileNameRequired", this.name));
    }
    if (ConfigurationProfilePresetCodes.isKnownPreset(this.name)) {
      throw new AwsWrapperError(Messages.get("ConfigurationProfileBuilder.canNotUpdateKnownPreset", this.name));
    }
    return new ConfigurationProfile(
      this.name,
      this.pluginFactories,
      this.properties,
      this.databaseDialect,
      this.driverDialect,
      this.awsCredentialProvider,
      this.connectionProvider
    );
  }

  public buildAndSet() {
    DriverConfigurationProfiles.addOrReplaceProfile(this.name, this.build());
  }
}
