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

import { PluginService } from "../plugin_service";
import { HostListProviderService } from "../host_list_provider_service";
import { PluginManager } from "../index";
import { ConnectionProvider } from "../connection_provider";
import { TelemetryFactory } from "./telemetry/telemetry_factory";
import { StorageService } from "./storage/storage_service";
import { MonitorService } from "./monitoring/monitor_service";
import { EventPublisher } from "./events/event";
import { ImportantEventService } from "./important_event_service";

/**
 * Container for services used throughout the wrapper.
 */
export interface FullServicesContainer {
  storageService: StorageService;
  monitorService: MonitorService;
  eventPublisher: EventPublisher;
  readonly defaultConnectionProvider: ConnectionProvider;
  telemetryFactory: TelemetryFactory;
  pluginManager: PluginManager;
  hostListProviderService: HostListProviderService;
  pluginService: PluginService;
  importantEventService: ImportantEventService;
}

export class FullServicesContainerImpl implements FullServicesContainer {
  storageService: StorageService;
  monitorService: MonitorService;
  eventPublisher: EventPublisher;
  readonly defaultConnectionProvider: ConnectionProvider;
  telemetryFactory: TelemetryFactory;
  pluginManager!: PluginManager;
  hostListProviderService!: HostListProviderService;
  pluginService!: PluginService;
  importantEventService: ImportantEventService;

  constructor(
    storageService: StorageService,
    monitorService: MonitorService,
    eventPublisher: EventPublisher,
    defaultConnProvider: ConnectionProvider,
    telemetryFactory: TelemetryFactory
  ) {
    this.storageService = storageService;
    this.monitorService = monitorService;
    this.eventPublisher = eventPublisher;
    this.defaultConnectionProvider = defaultConnProvider;
    this.telemetryFactory = telemetryFactory;
    this.importantEventService = new ImportantEventService();
  }
}
