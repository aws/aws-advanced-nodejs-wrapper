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

import { HostInfo } from "../../host_info";
import { ClientWrapper } from "../../client_wrapper";

export class WriterFailoverResult {
  readonly isConnected: boolean;
  readonly isNewHost: boolean;
  readonly topology: HostInfo[];
  readonly client: ClientWrapper | null;
  readonly taskName: string;
  readonly exception: Error | undefined;

  constructor(isConnected: boolean, isNewHost: boolean, topology: HostInfo[], taskName: string, client: ClientWrapper | null, exception?: Error) {
    this.isConnected = isConnected;
    this.isNewHost = isNewHost;
    this.topology = topology;
    this.client = client;
    this.taskName = taskName;
    this.exception = exception;
  }
}
