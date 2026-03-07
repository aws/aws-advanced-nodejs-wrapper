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

import { PluginService } from "../plugin_service";
import { HostListProviderService } from "../host_list_provider_service";
import { PluginManager } from "../index";
import { ConnectionProvider } from "../connection_provider";
import { TelemetryFactory } from "./telemetry/telemetry_factory";
import { StorageService } from "./storage/storage_service";
import { MonitorService } from "./monitoring/monitor_service";
import { EventPublisher } from "./events/event";
import { ImportantEventService } from "./important_event_service";

export interface FullServicesContainer {
  getStorageService(): StorageService;

  getMonitorService(): MonitorService;

  getEventPublisher(): EventPublisher;

  getDefaultConnectionProvider(): ConnectionProvider;

  getTelemetryFactory(): TelemetryFactory;

  getPluginManager(): PluginManager;

  getHostListProviderService(): HostListProviderService;

  getPluginService(): PluginService;

  getImportantEventService(): ImportantEventService;

  setMonitorService(monitorService: MonitorService): void;

  setStorageService(storageService: StorageService): void;

  setEventPublisher(eventPublisher: EventPublisher): void;

  setTelemetryFactory(telemetryFactory: TelemetryFactory): void;

  setPluginManager(connectionPluginManager: PluginManager): void;

  setHostListProviderService(hostListProviderService: HostListProviderService): void;

  setPluginService(pluginService: PluginService): void;

  setImportantEventService(importantEventService: ImportantEventService): void;
}

export class FullServicesContainerImpl implements FullServicesContainer {
  private storageService: StorageService;
  private monitorService: MonitorService;
  private eventPublisher: EventPublisher;
  private defaultConnectionProvider: ConnectionProvider;
  private telemetryFactory: TelemetryFactory;
  private pluginManager: PluginManager;
  private hostListProviderService: HostListProviderService;
  private pluginService: PluginService;
  private importantEventService: ImportantEventService;

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

  getStorageService(): StorageService {
    return this.storageService;
  }

  getMonitorService(): MonitorService {
    return this.monitorService;
  }

  getEventPublisher(): EventPublisher {
    return this.eventPublisher;
  }

  getDefaultConnectionProvider(): ConnectionProvider {
    return this.defaultConnectionProvider;
  }

  getTelemetryFactory(): TelemetryFactory {
    return this.telemetryFactory;
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  getHostListProviderService(): HostListProviderService {
    return this.hostListProviderService;
  }

  getPluginService(): PluginService {
    return this.pluginService;
  }

  getImportantEventService(): ImportantEventService {
    return this.importantEventService;
  }

  setMonitorService(monitorService: MonitorService): void {
    this.monitorService = monitorService;
  }

  setStorageService(storageService: StorageService): void {
    this.storageService = storageService;
  }

  setEventPublisher(eventPublisher: EventPublisher): void {
    this.eventPublisher = eventPublisher;
  }

  setTelemetryFactory(telemetryFactory: TelemetryFactory): void {
    this.telemetryFactory = telemetryFactory;
  }

  setPluginManager(connectionPluginManager: PluginManager): void {
    this.pluginManager = connectionPluginManager;
  }

  setHostListProviderService(hostListProviderService: HostListProviderService): void {
    this.hostListProviderService = hostListProviderService;
  }

  setPluginService(pluginService: PluginService): void {
    this.pluginService = pluginService;
  }

  setImportantEventService(importantEventService: ImportantEventService): void {
    this.importantEventService = importantEventService;
  }
}
