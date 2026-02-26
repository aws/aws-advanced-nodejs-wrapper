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

import { Monitor, MonitorErrorResponse, MonitorInitializer } from "./monitor";
import { Constructor } from "../../types";
import { FullServicesContainer } from "../full_services_container";

export interface MonitorService {
  registerMonitorTypeIfAbsent<T extends Monitor>(
    monitorClass: Constructor<T>,
    expirationTimeoutNanos: bigint,
    heartbeatTimeoutNanos: bigint,
    errorResponses: Set<MonitorErrorResponse>,
    producedDataClass?: Constructor<T>
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

  stopAndRemove<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): void;

  stopAndRemoveMonitors<T extends Monitor>(monitorClass: Constructor<T>): void;

  stopAndRemoveAll(): void;

  releaseResources(): void;
}

// TODO: complete implementation
export class MonitorServiceImpl implements MonitorService {
  get<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): T | null {
    return undefined;
  }

  registerMonitorTypeIfAbsent<T extends Monitor>(
    monitorClass: Constructor<T>,
    expirationTimeoutNanos: bigint,
    heartbeatTimeoutNanos: bigint,
    errorResponses: Set<MonitorErrorResponse>,
    producedDataClass?: Constructor<T>
  ): void {}

  releaseResources(): void {}

  remove<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): T | null {
    return undefined;
  }

  runIfAbsent<T extends Monitor>(
    monitorClass: Constructor<T>,
    key: unknown,
    servicesContainer: FullServicesContainer,
    originalProps: Map<string, unknown>,
    initializer: MonitorInitializer
  ): Promise<T> {
    return Promise.resolve(undefined);
  }

  stopAndRemove<T extends Monitor>(monitorClass: Constructor<T>, key: unknown): void {}

  stopAndRemoveAll(): void {}

  stopAndRemoveMonitors<T extends Monitor>(monitorClass: Constructor<T>): void {}
}
