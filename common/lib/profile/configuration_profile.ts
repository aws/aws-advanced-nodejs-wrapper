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

export class ConfigurationProfile {
  protected readonly name: string;
  protected readonly pluginFactories: (typeof ConnectionPluginFactory)[];
  protected readonly properties: Map<string, any>;
  protected readonly databaseDialect: DatabaseDialect | (() => DatabaseDialect) | null;
  protected readonly driverDialect: DriverDialect | (() => DriverDialect) | null;
  protected readonly awsCredentialProvider: any | null; //AwsCredentialsProviderHandler
  protected readonly connectionProvider: ConnectionProvider | (() => ConnectionProvider) | null;

  // Initialized objects
  protected databaseDialectObj: DatabaseDialect | null = null;
  protected driverDialectObj: DriverDialect | null = null;
  protected awsCredentialProviderObj: any | null = null; //AwsCredentialsProviderHandler
  protected connectionProviderObj: ConnectionProvider | null = null;

  constructor(
    name: string,
    pluginFactories: (typeof ConnectionPluginFactory)[], // Factories should be presorted by weights!
    properties: Map<string, any>,
    databaseDialect: DatabaseDialect | (() => DatabaseDialect) | null,
    driverDialect: DriverDialect | (() => DriverDialect) | null,
    awsCredentialProvider: any,
    connectionProvider: ConnectionProvider | (() => ConnectionProvider) | null
  ) {
    this.name = name;
    this.pluginFactories = pluginFactories;
    this.properties = properties;
    this.databaseDialect = databaseDialect;
    this.driverDialect = driverDialect;
    this.awsCredentialProvider = awsCredentialProvider;
    this.connectionProvider = connectionProvider;
  }

  public getName(): string {
    return this.name;
  }

  public getProperties(): Map<string, any> {
    return this.properties;
  }

  public getPluginFactories(): (typeof ConnectionPluginFactory)[] {
    return this.pluginFactories;
  }

  public getDatabaseDialect(): DatabaseDialect | null {
    if (this.databaseDialectObj) {
      return this.databaseDialectObj;
    }
    if (!this.databaseDialect) {
      return null;
    }

    if (typeof this.driverDialect === "function") {
      this.databaseDialectObj = (this.databaseDialect as () => DatabaseDialect)();
    } else {
      this.databaseDialectObj = this.databaseDialect as DatabaseDialect;
    }
    return this.databaseDialectObj;
  }

  public getDriverDialect(): DriverDialect | null {
    if (this.driverDialectObj) {
      return this.driverDialectObj;
    }
    if (!this.driverDialect) {
      return null;
    }

    if (typeof this.driverDialect === "function") {
      this.driverDialectObj = (this.driverDialect as () => DriverDialect)();
    } else {
      this.driverDialectObj = this.driverDialect as DriverDialect;
    }
    return this.driverDialectObj;
  }

  public getConnectionProvider(): ConnectionProvider | null {
    if (this.connectionProviderObj) {
      return this.connectionProviderObj;
    }
    if (!this.connectionProvider) {
      return null;
    }

    if (typeof this.connectionProvider === "function") {
      this.connectionProviderObj = (this.connectionProvider as () => ConnectionProvider)();
    } else {
      this.connectionProviderObj = this.connectionProvider as ConnectionProvider;
    }
    return this.connectionProviderObj;
  }

  public getAwsCredentialProvider(): any | null {
    if (this.awsCredentialProviderObj) {
      return this.awsCredentialProviderObj;
    }
    if (!this.awsCredentialProvider) {
      return null;
    }

    if (typeof this.awsCredentialProvider === "function") {
      this.awsCredentialProviderObj = (this.awsCredentialProvider as () => any)();
    } else {
      this.awsCredentialProviderObj = this.awsCredentialProvider;
    }
    return this.awsCredentialProviderObj;
  }
}
