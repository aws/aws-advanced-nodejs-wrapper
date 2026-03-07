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

import { BatchingEventPublisher } from "../../common/lib/utils/events/batching_event_publisher";
import { DataAccessEvent } from "../../common/lib/utils/events/data_access_event";
import { Event, EventSubscriber } from "../../common/lib/utils/events/event";

class TestableEventPublisher extends BatchingEventPublisher {
  constructor() {
    super(0); // Pass 0 to avoid starting the interval
  }

  protected initPublishingInterval(_messageIntervalMs: number): void {
    // Do nothing.
  }

  get subscriberCount(): number {
    return this.subscribersMap.size;
  }

  get pendingEventCount(): number {
    return this.pendingEvents.size;
  }

  triggerSendMessages(): void {
    this.sendMessages();
  }
}

// A simple class to use as the dataClass in DataAccessEvent
class TestDataClass {}

describe("BatchingEventPublisher", () => {
  let publisher: TestableEventPublisher;
  let mockSubscriber: EventSubscriber;
  let processEventCalls: Event[];

  beforeEach(() => {
    publisher = new TestableEventPublisher();
    processEventCalls = [];
    mockSubscriber = {
      processEvent: (event: Event) => {
        processEventCalls.push(event);
      }
    };
  });

  afterEach(() => {
    publisher.releaseResources();
  });

  it("should publish events to subscribers and deduplicate", () => {
    const eventSubscriptions = new Set([DataAccessEvent]);

    publisher.subscribe(mockSubscriber, eventSubscriptions);
    publisher.subscribe(mockSubscriber, eventSubscriptions);
    expect(publisher.subscriberCount).toBe(1);

    const event = new DataAccessEvent(TestDataClass, "key");
    publisher.publish(event);
    publisher.publish(event);

    publisher.triggerSendMessages();

    expect(publisher.pendingEventCount).toBe(0);

    expect(processEventCalls.length).toBe(1);
    expect(processEventCalls[0]).toBe(event);

    publisher.unsubscribe(mockSubscriber, eventSubscriptions);
    publisher.publish(event);
    publisher.triggerSendMessages();

    expect(publisher.pendingEventCount).toBe(0);

    expect(processEventCalls.length).toBe(1);
  });

  it("should deliver immediate events synchronously", () => {
    const immediateEvent: Event = {
      isImmediateDelivery: true
    };

    const eventSubscriptions = new Set([immediateEvent.constructor as new (...args: any[]) => Event]);
    publisher.subscribe(mockSubscriber, eventSubscriptions);

    publisher.publish(immediateEvent);

    expect(processEventCalls.length).toBe(1);
    expect(processEventCalls[0]).toBe(immediateEvent);

    expect(publisher.pendingEventCount).toBe(0);
  });

  it("should not deliver events to unsubscribed subscribers", () => {
    const eventSubscriptions = new Set([DataAccessEvent]);

    publisher.subscribe(mockSubscriber, eventSubscriptions);
    publisher.unsubscribe(mockSubscriber, eventSubscriptions);

    const event = new DataAccessEvent(TestDataClass, "key");
    publisher.publish(event);
    publisher.triggerSendMessages();

    expect(processEventCalls.length).toBe(0);
  });

  it("should handle multiple subscribers", () => {
    const processEventCalls2: Event[] = [];
    const mockSubscriber2: EventSubscriber = {
      processEvent: (event: Event) => {
        processEventCalls2.push(event);
      }
    };

    const eventSubscriptions = new Set([DataAccessEvent]);

    publisher.subscribe(mockSubscriber, eventSubscriptions);
    publisher.subscribe(mockSubscriber2, eventSubscriptions);

    const event = new DataAccessEvent(TestDataClass, "key");
    publisher.publish(event);
    publisher.triggerSendMessages();

    expect(processEventCalls.length).toBe(1);
    expect(processEventCalls2.length).toBe(1);
  });
});
