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

import { Event, EventClass, EventPublisher, EventSubscriber } from "./event";
import { Messages } from "../messages";
import { logger } from "../../../logutils";

const DEFAULT_MESSAGE_INTERVAL_MS = 30_000; // 30 seconds

/**
 * An event publisher that periodically publishes a batch of all unique events
 * encountered during the latest time interval.
 */
export class BatchingEventPublisher implements EventPublisher {
  protected readonly subscribersMap = new Map<EventClass, Set<EventSubscriber>>();
  protected readonly pendingEvents = new Set<Event>();
  protected publishingInterval?: ReturnType<typeof setInterval>;

  constructor(messageIntervalMs: number = DEFAULT_MESSAGE_INTERVAL_MS) {
    this.initPublishingInterval(messageIntervalMs);
  }

  protected initPublishingInterval(messageIntervalMs: number): void {
    this.publishingInterval = setInterval(() => this.sendMessages(), messageIntervalMs);
    // Unref the timer to prevent this background task from blocking the application from gracefully exiting.
    this.publishingInterval.unref();
  }

  protected async sendMessages(): Promise<void> {
    for (const event of this.pendingEvents) {
      this.pendingEvents.delete(event);
      await this.deliverEvent(event);
    }
  }

  protected async deliverEvent(event: Event): Promise<void> {
    const subscribers = this.subscribersMap.get(event.constructor as EventClass);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      await subscriber.processEvent(event);
    }
  }

  subscribe(subscriber: EventSubscriber, eventClasses: Set<EventClass>): void {
    for (const eventClass of eventClasses) {
      let subscribers = this.subscribersMap.get(eventClass);
      if (!subscribers) {
        subscribers = new Set();
        this.subscribersMap.set(eventClass, subscribers);
      }
      subscribers.add(subscriber);
    }
  }

  unsubscribe(subscriber: EventSubscriber, eventClasses: Set<EventClass>): void {
    for (const eventClass of eventClasses) {
      const subscribers = this.subscribersMap.get(eventClass);
      if (subscribers) {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) {
          this.subscribersMap.delete(eventClass);
        }
      }
    }
  }

  publish(event: Event): void {
    if (event.isImmediateDelivery) {
      this.deliverEvent(event).catch((err) => {
        logger.debug(Messages.get("BatchingEventPublisher.errorDeliveringImmediateEvent", err?.message ?? String(err)));
      });
    } else {
      this.pendingEvents.add(event);
    }
  }

  releaseResources(): void {
    if (this.publishingInterval) {
      clearInterval(this.publishingInterval);
      this.publishingInterval = undefined;
    }
  }
}
