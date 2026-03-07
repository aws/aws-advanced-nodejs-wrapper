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

import { EventClass } from "../../types";

/**
 * An interface for events that need to be communicated between different components.
 */
export interface Event {
  readonly isImmediateDelivery: boolean;
}

/**
 * An event subscriber. Subscribers can subscribe to a publisher's events.
 */
export interface EventSubscriber {
  /**
   * Processes an event. This method will only be called on this subscriber
   * if it has subscribed to the event class.
   * @param event the event to process.
   */
  processEvent(event: Event): void;
}

/**
 * An event publisher that publishes events to subscribers.
 * Subscribers can specify which types of events they would like to receive.
 */
export interface EventPublisher {
  /**
   * Registers the given subscriber for the given event classes.
   * @param subscriber the subscriber to be notified when the given event classes occur.
   * @param eventClasses the classes of events that the subscriber should be notified of.
   */
  subscribe(subscriber: EventSubscriber, eventClasses: Set<EventClass>): void;

  /**
   * Unsubscribes the given subscriber from the given event classes.
   * @param subscriber the subscriber to unsubscribe from the given event classes.
   * @param eventClasses the classes of events that the subscriber wants to unsubscribe from.
   */
  unsubscribe(subscriber: EventSubscriber, eventClasses: Set<EventClass>): void;

  /**
   * Publishes an event. All subscribers to the given event class will be notified of the event.
   * @param event the event to publish.
   */
  publish(event: Event): void;
}
