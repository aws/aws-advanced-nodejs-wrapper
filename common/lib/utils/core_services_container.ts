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

import { StorageService, StorageServiceImpl } from "./storage/storage_service";
import { MonitorService, MonitorServiceImpl } from "./monitoring/monitor_service";

/**
 * A singleton container object used to instantiate and access core universal services. This class should be used
 * instead of directly instantiating core services so that only one instance of each service is instantiated.
 *
 * @see FullServicesContainer for a container that holds both connection-specific services and core universal
 *     services.
 */
export class CoreServicesContainer {
  private static readonly INSTANCE = new CoreServicesContainer();

  // TODO: implement monitor service
  private readonly monitorService: MonitorService;
  private readonly storageService: StorageService;

  private constructor() {
    this.storageService = new StorageServiceImpl();
    this.monitorService = new MonitorServiceImpl();
  }

  static getInstance(): CoreServicesContainer {
    return CoreServicesContainer.INSTANCE;
  }

  getStorageService(): StorageService {
    return this.storageService;
  }

  getMonitorService(): MonitorService {
    return this.monitorService;
  }

  static releaseResources(): void {
    CoreServicesContainer.INSTANCE.storageService.releaseResources();
  }
}
