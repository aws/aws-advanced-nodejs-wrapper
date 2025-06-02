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

import { ClientWrapper } from "../client_wrapper";

export class BlueGreenResult {
  private readonly _version: string;
  private readonly _endpoint: string;
  private readonly _port: number;
  private readonly _role: string;
  private readonly _status: string;

  constructor(version: string, endpoint: string, port: number, role: string, status: string) {
    this._version = version;
    this._endpoint = endpoint;
    this._port = port;
    this._role = role;
    this._status = status;
  }

  get version(): string {
    return this._version;
  }

  get endpoint(): string {
    return this._endpoint;
  }

  get port(): number {
    return this._port;
  }

  get role(): string {
    return this._role;
  }

  get status(): string {
    return this._status;
  }
}

export interface BlueGreenDialect {
  isBlueGreenStatusAvailable(clientWrapper: ClientWrapper): Promise<boolean>;
  getBlueGreenStatus(clientWrapper: ClientWrapper): Promise<BlueGreenResult[] | null>;
}
