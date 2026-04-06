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

export class ImportantEvent {
  readonly timestamp: Date;
  readonly description: string;

  constructor(timestamp: Date, description: string) {
    this.timestamp = timestamp;
    this.description = description;
  }
}

export class ImportantEventService {
  private static readonly DEFAULT_EVENT_QUEUE_MS = 60000;

  private readonly events: ImportantEvent[] = [];
  private readonly eventQueueMs: number;
  private readonly isEnabled: boolean;

  constructor(isEnabled: boolean = true, eventQueueMs: number = ImportantEventService.DEFAULT_EVENT_QUEUE_MS) {
    this.isEnabled = isEnabled;
    this.eventQueueMs = eventQueueMs;
  }

  clear(): void {
    this.events.length = 0;
  }

  registerEvent(descriptionSupplier: () => string): void {
    if (!this.isEnabled) {
      return;
    }

    this.removeExpiredEvents();

    this.events.push(new ImportantEvent(new Date(), descriptionSupplier()));
  }

  getEvents(): ImportantEvent[] {
    if (!this.isEnabled) {
      return [];
    }

    this.removeExpiredEvents();
    return [...this.events];
  }

  private removeExpiredEvents(): void {
    if (!this.isEnabled || this.events.length === 0) {
      return;
    }

    const current = Date.now();
    const cutoffTime = current - this.eventQueueMs;

    while (this.events.length > 0 && this.events[0].timestamp.getTime() <= cutoffTime) {
      this.events.shift();
    }
  }
}

export class DriverImportantEventService {
  private static readonly INSTANCE = new ImportantEventService(true, 60000);

  private constructor() {}

  static getInstance(): ImportantEventService {
    return DriverImportantEventService.INSTANCE;
  }

  static clear(): void {
    DriverImportantEventService.INSTANCE.clear();
  }
}
