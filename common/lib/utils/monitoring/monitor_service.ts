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

import { Monitor, MonitorErrorResponse, MonitorInitializer, MonitorSettings, MonitorState } from "./monitor";
import { Constructor } from "../../types";
import { FullServicesContainer } from "../full_services_container";
import { logger } from "../../../logutils";
import { Messages } from "../messages";
import { AwsWrapperError } from "../errors";
import { ClusterTopologyMonitorImpl } from "../../host_list_provider/monitoring/cluster_topology_monitor";
import { Topology } from "../../host_list_provider/topology";
import { Event, EventPublisher, EventSubscriber } from "../events/event";
import { DataAccessEvent } from "../events/data_access_event";
import { MonitorStopEvent } from "../events/monitor_stop_event";
import { convertNanosToMs, getTimeInNanos, sleepWithAbort } from "../utils";
import { CacheItem } from "../cache_map";

const DEFAULT_CLEANUP_INTERVAL_NS = BigInt(60_000_000_000); // 1 minute
const FIFTEEN_MINUTES_NS = BigInt(15 * 60 * 1_000_000_000);
const THREE_MINUTES_NS = BigInt(3 * 60 * 1_000_000_000);

export interface MonitorService {
  registerMonitorTypeIfAbsent<T extends Monitor>(
    monitorClass: Constructor<T>,
    expirationTimeoutNanos: bigint,
    inactiveTimeoutNanos: bigint,
    errorResponses: Set<MonitorErrorResponse>,
    producedDataClass?: Constructor
  ): void;

  runIfAbsent<T extends Monitor>(
    monitorClass: Constructor<T>,
    key: unknown,
    servicesContainer: FullServicesContainer,
    originalProps: Map<string, unknown>,
    initializer: MonitorInitializer
  ): Promise<T>;

  get<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): T | null;

  remove<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): T | null;

  stopAndRemove<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): Promise<void>;

  stopAndRemoveMonitors<T extends Monitor>(monitorClass: Constructor<T>): Promise<void>;

  stopAndRemoveAll(): Promise<void>;

  releaseResources(): Promise<void>;
}

/**
 * A container object that holds a monitor together with the supplier used to generate the monitor.
 * The supplier can be used to recreate the monitor if it encounters an error or becomes stuck.
 */
class MonitorItem {
  private readonly monitorSupplier: () => Monitor;
  private readonly _monitor: Monitor;

  constructor(monitorSupplier: () => Monitor) {
    this.monitorSupplier = monitorSupplier;
    this._monitor = monitorSupplier();
  }

  getMonitorSupplier(): () => Monitor {
    return this.monitorSupplier;
  }

  getMonitor(): Monitor {
    return this._monitor;
  }
}

/**
 * A container that holds a cache of monitors of a given type with the related settings and info for that type.
 */
class CacheContainer {
  private readonly settings: MonitorSettings;
  private readonly cache: Map<unknown, CacheItem<MonitorItem>>;
  private readonly producedDataClass: Constructor | null;

  constructor(settings: MonitorSettings, producedDataClass: Constructor | null) {
    this.settings = settings;
    this.producedDataClass = producedDataClass;
    this.cache = new Map<unknown, CacheItem<MonitorItem>>();
  }

  getSettings(): MonitorSettings {
    return this.settings;
  }

  getCache(): Map<unknown, CacheItem<MonitorItem>> {
    return this.cache;
  }

  getProducedDataClass(): Constructor | null {
    return this.producedDataClass;
  }
}

export class MonitorServiceImpl implements MonitorService, EventSubscriber {
  private static defaultSuppliers: Map<Constructor<Monitor>, () => CacheContainer> | null = null;

  // Lazy initialization for the default suppliers to avoid circular dependencies.
  private static getDefaultSuppliers(): Map<Constructor<Monitor>, () => CacheContainer> {
    if (!MonitorServiceImpl.defaultSuppliers) {
      const recreateOnError = new Set([MonitorErrorResponse.RECREATE]);
      const defaultSettings = new MonitorSettings(FIFTEEN_MINUTES_NS, THREE_MINUTES_NS, recreateOnError);

      MonitorServiceImpl.defaultSuppliers = new Map([[ClusterTopologyMonitorImpl, () => new CacheContainer(defaultSettings, Topology)]]);
    }
    return MonitorServiceImpl.defaultSuppliers;
  }

  protected readonly publisher: EventPublisher;
  protected readonly monitorCaches = new Map<Constructor<Monitor>, CacheContainer>();
  // Use a pending promise map to prevent race conditions when creating monitors.
  private readonly pendingMonitors = new Map<string, Promise<Monitor>>();
  private cleanupTask: Promise<void> | null = null;
  private interruptCleanupTask: (() => void) | null = null;
  private isInitialized: boolean = false;

  constructor(publisher: EventPublisher, cleanupIntervalNs: bigint = DEFAULT_CLEANUP_INTERVAL_NS) {
    this.publisher = publisher;
    this.publisher.subscribe(this, new Set([DataAccessEvent, MonitorStopEvent]));
    this.initCleanupTask(cleanupIntervalNs);
  }

  protected initCleanupTask(cleanupIntervalNs: bigint): void {
    this.isInitialized = true;
    this.cleanupTask = this.runCleanupLoop(cleanupIntervalNs);
  }

  private async runCleanupLoop(cleanupIntervalNs: bigint): Promise<void> {
    while (this.isInitialized) {
      const [sleepPromise, abortSleepFunc] = sleepWithAbort(
        convertNanosToMs(cleanupIntervalNs),
        Messages.get("MonitorService.cleanupTaskInterrupted")
      );
      this.interruptCleanupTask = abortSleepFunc;
      try {
        await sleepPromise;
      } catch {
        // Sleep has been interrupted, exit cleanup task.
        return;
      }

      await this.checkMonitors();
    }
  }

  protected async checkMonitors(): Promise<void> {
    for (const container of this.monitorCaches.values()) {
      const cache = container.getCache();
      const keysToProcess = Array.from(cache.keys());

      for (const key of keysToProcess) {
        const cacheItem = cache.get(key);
        if (!cacheItem) {
          continue;
        }

        const monitorItem = cacheItem.get(true);
        if (!monitorItem) {
          continue;
        }

        const monitor = monitorItem.getMonitor();
        const monitorSettings = container.getSettings();

        // Check for stopped monitors
        if (monitor.getState() === MonitorState.STOPPED) {
          cache.delete(key);
          await monitor.stop();
          continue;
        }

        // Check for error state monitors
        if (monitor.getState() === MonitorState.ERROR) {
          cache.delete(key);
          logger.debug(Messages.get("MonitorService.removedErrorMonitor", JSON.stringify(monitor)));
          await this.handleMonitorError(container, key, monitorItem);
          continue;
        }

        // Check for inactive/stuck monitors
        const inactiveTimeoutNs = monitorSettings.inactiveTimeoutNanos;
        if (getTimeInNanos() - monitor.getLastActivityTimestampNanos() > inactiveTimeoutNs) {
          cache.delete(key);
          logger.info(Messages.get("MonitorService.monitorStuck", JSON.stringify(monitor), convertNanosToMs(inactiveTimeoutNs).toString()));
          await this.handleMonitorError(container, key, monitorItem);
          continue;
        }

        // Check for expired monitors that can be disposed
        if (cacheItem.isExpired() && monitor.canDispose()) {
          cache.delete(key);
          logger.info(Messages.get("MonitorService.removedExpiredMonitor", JSON.stringify(monitor)));
          await monitor.stop();
        }
      }
    }
  }

  protected async handleMonitorError(cacheContainer: CacheContainer, key: unknown, errorMonitorItem: MonitorItem): Promise<void> {
    const monitor = errorMonitorItem.getMonitor();
    await monitor.stop();

    const errorResponses = cacheContainer.getSettings().errorResponses;
    if (errorResponses && errorResponses.has(MonitorErrorResponse.RECREATE)) {
      if (!cacheContainer.getCache().has(key)) {
        logger.info(Messages.get("MonitorService.recreatingMonitor", JSON.stringify(monitor)));
        const newMonitorItem = new MonitorItem(errorMonitorItem.getMonitorSupplier());
        const expirationNs = cacheContainer.getSettings().expirationTimeoutNanos;
        cacheContainer.getCache().set(key, new CacheItem(newMonitorItem, getTimeInNanos() + expirationNs));
        await newMonitorItem.getMonitor().start();
      }
    }
  }

  registerMonitorTypeIfAbsent<T extends Monitor>(
    monitorClass: Constructor<T>,
    expirationTimeoutNanos: bigint,
    inactiveTimeoutNanos: bigint,
    errorResponses: Set<MonitorErrorResponse>,
    producedDataClass?: Constructor<unknown>
  ): void {
    if (this.monitorCaches.has(monitorClass)) {
      return;
    }

    const settings = new MonitorSettings(expirationTimeoutNanos, inactiveTimeoutNanos, errorResponses);
    const cacheContainer = new CacheContainer(settings, producedDataClass ?? null);
    this.monitorCaches.set(monitorClass, cacheContainer);
  }

  async runIfAbsent<T extends Monitor>(
    monitorClass: Constructor<T>,
    key: unknown,
    servicesContainer: FullServicesContainer,
    _originalProps: Map<string, unknown>,
    initializer: MonitorInitializer
  ): Promise<T> {
    let cacheContainer = this.monitorCaches.get(monitorClass);

    if (!cacheContainer) {
      const supplier = MonitorServiceImpl.getDefaultSuppliers().get(monitorClass as Constructor<Monitor>);
      if (!supplier) {
        throw new AwsWrapperError(Messages.get("MonitorService.monitorTypeNotRegistered", monitorClass.name));
      }

      cacheContainer = supplier();
      this.monitorCaches.set(monitorClass, cacheContainer);
    }

    const cache = cacheContainer.getCache();
    const existingCacheItem = cache.get(key);
    if (existingCacheItem) {
      const existingMonitorItem = existingCacheItem.get(true);
      if (existingMonitorItem) {
        existingCacheItem.updateExpiration(cacheContainer.getSettings().expirationTimeoutNanos);
        return existingMonitorItem.getMonitor() as T;
      }
    }

    const pendingKey = `${monitorClass.name}:${JSON.stringify(key)}`;

    // Check if the monitor is already being created by another async task.
    const pendingPromise = this.pendingMonitors.get(pendingKey);
    if (pendingPromise) {
      return (await pendingPromise) as T;
    }

    // Use the pending promise pattern to create monitors. This prevents race condition.
    const createPromise = (async (): Promise<Monitor> => {
      try {
        const recheckCacheItem = cache.get(key);
        if (recheckCacheItem) {
          const recheckMonitorItem = recheckCacheItem.get(true);
          if (recheckMonitorItem) {
            recheckCacheItem.updateExpiration(cacheContainer.getSettings().expirationTimeoutNanos);
            return recheckMonitorItem.getMonitor();
          }
        }

        const monitorItem = new MonitorItem(() => initializer.createMonitor(servicesContainer));
        const expirationNs = cacheContainer.getSettings().expirationTimeoutNanos;
        cache.set(key, new CacheItem(monitorItem, getTimeInNanos() + expirationNs));
        await monitorItem.getMonitor().start();

        return monitorItem.getMonitor();
      } finally {
        // Delete the key once monitor has been successfully created.
        this.pendingMonitors.delete(pendingKey);
      }
    })();

    this.pendingMonitors.set(pendingKey, createPromise);
    return (await createPromise) as T;
  }

  get<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): T | null {
    const cacheContainer = this.monitorCaches.get(monitorClass);
    if (!cacheContainer) {
      return null;
    }

    const cacheItem = cacheContainer.getCache().get(key);
    if (!cacheItem) {
      return null;
    }

    const monitorItem = cacheItem.get(true);
    if (!monitorItem) {
      return null;
    }

    const monitor = monitorItem.getMonitor();
    if (monitor instanceof monitorClass) {
      return monitor as T;
    }

    logger.info(Messages.get("MonitorService.monitorClassMismatch", JSON.stringify(key), monitorClass.name, JSON.stringify(monitor)));
    return null;
  }

  remove<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): T | null {
    const cacheContainer = this.monitorCaches.get(monitorClass);
    if (!cacheContainer) {
      return null;
    }

    const cache = cacheContainer.getCache();
    const cacheItem = cache.get(key);
    if (!cacheItem) {
      return null;
    }

    const monitorItem = cacheItem.get(true);
    if (!monitorItem) {
      return null;
    }

    const monitor = monitorItem.getMonitor();
    if (monitor instanceof monitorClass) {
      cache.delete(key);
      return monitor as T;
    }

    return null;
  }

  async stopAndRemove<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): Promise<void> {
    const cacheContainer = this.monitorCaches.get(monitorClass);
    if (!cacheContainer) {
      logger.info(Messages.get("MonitorService.stopAndRemoveMissingMonitorType", monitorClass.name, String(key)));
      return;
    }

    const cache = cacheContainer.getCache();
    const cacheItem = cache.get(key);
    if (cacheItem) {
      cache.delete(key);
      await cacheItem.get(true)?.getMonitor().stop();
    }
  }

  async stopAndRemoveMonitors<T extends Monitor>(monitorClass: Constructor<T>): Promise<void> {
    const cacheContainer = this.monitorCaches.get(monitorClass);
    if (!cacheContainer) {
      logger.info(Messages.get("MonitorService.stopAndRemoveMonitorsMissingType", monitorClass.name));
      return;
    }

    const cache = cacheContainer.getCache();
    for (const [key, cacheItem] of cache.entries()) {
      cache.delete(key);
      await cacheItem.get(true)?.getMonitor().stop();
    }
  }

  async stopAndRemoveAll(): Promise<void> {
    for (const monitorClass of this.monitorCaches.keys()) {
      await this.stopAndRemoveMonitors(monitorClass);
    }
  }

  async releaseResources(): Promise<void> {
    // Stop cleanup task
    this.isInitialized = false;
    this.interruptCleanupTask?.();
    if (this.cleanupTask) {
      await this.cleanupTask;
    }

    await this.stopAndRemoveAll();
  }

  async processEvent(event: Event): Promise<void> {
    if (event instanceof DataAccessEvent) {
      for (const container of this.monitorCaches.values()) {
        if (!container.getProducedDataClass() || event.dataClass !== container.getProducedDataClass()) {
          continue;
        }

        // The data produced by the monitor in this cache with this key has been accessed recently,
        // so we extend the monitor's expiration.
        container.getCache().get(event.key)?.updateExpiration(container.getSettings().expirationTimeoutNanos);
      }
      return;
    }

    if (event instanceof MonitorStopEvent) {
      await this.stopAndRemove(event.monitorClass, event.key);
      return;
    }

    // Other event types should be propagated to monitors
    for (const container of this.monitorCaches.values()) {
      for (const cacheItem of container.getCache().values()) {
        const monitorItem = cacheItem.get(true);
        if (!monitorItem) {
          continue;
        }

        const monitor = monitorItem.getMonitor();
        if (this.isEventSubscriber(monitor)) {
          await (monitor as unknown as EventSubscriber).processEvent(event);
        }
      }
    }
  }

  private isEventSubscriber(obj: unknown): obj is EventSubscriber {
    return typeof obj === "object" && obj !== null && "processEvent" in obj && typeof (obj as EventSubscriber).processEvent === "function";
  }
}
