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

export class TestInstanceInfo {
  private readonly _instanceId?: string;
  private readonly _host?: string;
  private readonly _port?: number;

  constructor(instanceInfo: { [s: string]: any }) {
    this._instanceId = instanceInfo.instanceId;
    this._host = instanceInfo.host;
    this._port = instanceInfo.port;

    if (this._instanceId === undefined) {
      this._instanceId = instanceInfo.DBInstanceIdentifier;
    }
    const endpoint = instanceInfo.Endpoint;
    if (endpoint !== undefined) {
      if (this._host === undefined) {
        this._host = endpoint.Address;
      }
      if (this._port === undefined) {
        this._port = endpoint.Port;
      }
    }
  }

  get instanceId(): string | undefined {
    return this._instanceId;
  }

  get host(): string | undefined {
    return this._host;
  }

  get port(): number | undefined {
    return this._port;
  }

  get url() {
    return this._host + ":" + String(this._port);
  }
}
