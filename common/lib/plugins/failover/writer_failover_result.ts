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

import { AwsClient } from "../../aws_client";
import { HostInfo } from "../../host_info";

export class WriterFailoverResult {
  private readonly _isConnected: boolean;
  private readonly _isNewHost: boolean;
  private readonly _topology: HostInfo[];
  private readonly _client: any | null;
  private readonly _taskName: string;
  private readonly _exception: Error | undefined;

  constructor(isConnected: boolean, isNewHost: boolean, topology: HostInfo[], taskName: string, client: any | null, exception?: Error) {
    this._isConnected = isConnected;
    this._isNewHost = isNewHost;
    this._topology = topology;
    this._client = client;
    this._taskName = taskName;
    this._exception = exception;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isNewHost(): boolean {
    return this._isNewHost;
  }

  get topology(): HostInfo[] {
    return this._topology;
  }

  get client(): AwsClient | null {
    return this._client;
  }

  get taskName(): string {
    return this._taskName;
  }

  get exception(): Error | undefined {
    return this._exception;
  }
}
