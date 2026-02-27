/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FullServicesContainer, FullServicesContainerImpl } from "./full_services_container";
import { StorageService } from "./storage/storage_service";
import { PluginServiceImpl } from "../plugin_service";
import { PluginManager } from "../plugin_manager";
import { ConnectionProviderManager } from "../connection_provider_manager";
import { DriverConnectionProvider } from "../driver_connection_provider";
import { WrapperProperties } from "../wrapper_property";
import { ConnectionProvider } from "../connection_provider";
import { AwsClient } from "../aws_client";
import { DatabaseDialect, DatabaseType } from "../database_dialect/database_dialect";
import { DatabaseDialectCodes } from "../database_dialect/database_dialect_codes";
import { DriverDialect } from "../driver_dialect/driver_dialect";
import { MonitorService } from "./monitoring/monitor_service";
import { TelemetryFactory } from "./telemetry/telemetry_factory";

export class ServiceUtils {
  private static readonly _instance: ServiceUtils = new ServiceUtils();

  static get instance(): ServiceUtils {
    return this._instance;
  }

  createStandardServiceContainer(
    storageService: StorageService,
    monitorService: MonitorService,
    client: AwsClient,
    props: Map<string, unknown>,
    dbType: DatabaseType,
    knownDialectsByCode: Map<DatabaseDialectCodes, DatabaseDialect>,
    driverDialect: DriverDialect,
    telemetryFactory: TelemetryFactory,
    connectionProvider: ConnectionProvider | null
  ): FullServicesContainer {
    const servicesContainer: FullServicesContainer = new FullServicesContainerImpl(
      storageService,
      monitorService,
      connectionProvider,
      telemetryFactory
    );

    const pluginService = new PluginServiceImpl(servicesContainer, client, dbType, knownDialectsByCode, props, driverDialect);
    const pluginManager = new PluginManager(
      servicesContainer,
      props,
      new ConnectionProviderManager(connectionProvider ?? new DriverConnectionProvider(), WrapperProperties.CONNECTION_PROVIDER.get(props)),
      telemetryFactory
    );

    servicesContainer.setPluginService(pluginService);
    servicesContainer.setPluginManager(pluginManager);
    servicesContainer.setHostListProviderService(pluginService);

    return servicesContainer;
  }

  async createMinimalServiceContainer(
    storageService: StorageService,
    monitorService: MonitorService,
    client: AwsClient,
    props: Map<string, unknown>,
    dbType: DatabaseType,
    knownDialectsByCode: Map<DatabaseDialectCodes, DatabaseDialect>,
    driverDialect: DriverDialect,
    telemetryFactory: TelemetryFactory,
    connectionProvider: ConnectionProvider | null
  ): Promise<FullServicesContainer> {
    const servicesContainer: FullServicesContainer = new FullServicesContainerImpl(
      storageService,
      monitorService,
      connectionProvider,
      telemetryFactory
    );

    const pluginService = new PluginServiceImpl(servicesContainer, client, dbType, knownDialectsByCode, props, driverDialect);
    const pluginManager = new PluginManager(
      servicesContainer,
      props,
      new ConnectionProviderManager(connectionProvider ?? new DriverConnectionProvider(), WrapperProperties.CONNECTION_PROVIDER.get(props)),
      telemetryFactory
    );

    servicesContainer.setPluginService(pluginService);
    servicesContainer.setPluginManager(pluginManager);
    servicesContainer.setHostListProviderService(pluginService);

    await pluginManager.init();
    return servicesContainer;
  }
}
