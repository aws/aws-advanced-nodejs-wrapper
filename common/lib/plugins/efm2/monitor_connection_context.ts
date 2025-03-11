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

import { uniqueId } from "../../../logutils";
import { ClientWrapper } from "../../client_wrapper";

/**
 * Monitoring context for each connection. This contains each connection's criteria for whether a
 * server should be considered unhealthy. The context is shared between the main task and the monitor task.
 */
export class MonitorConnectionContext {
  private clientToAbortRef: WeakRef<ClientWrapper> | undefined;
  isHostUnhealthy: boolean = false;
  id: string = uniqueId("_monitorContext");

  /**
   * Constructor.
   *
   * @param clientToAbort A reference to the connection associated with this context that will be aborted.
   */
  constructor(clientToAbort: ClientWrapper) {
    this.clientToAbortRef = new WeakRef(clientToAbort);
  }

  setHostUnhealthy(hostUnhealthy: boolean) {
    this.isHostUnhealthy = hostUnhealthy;
  }

  shouldAbort(): boolean {
    return this.isHostUnhealthy && this.clientToAbortRef != null;
  }

  setInactive(): void {
    this.clientToAbortRef = null;
  }

  getClient(): ClientWrapper | null {
    return this.clientToAbortRef?.deref() ?? null;
  }

  isActive() {
    return !!this.clientToAbortRef?.deref();
  }
}
