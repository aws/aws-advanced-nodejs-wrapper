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

import { Proxy } from "toxiproxy-node-client";

export class ProxyInfo {
  private _proxy: Proxy;
  private _controlHost: string;
  private _controlPort: number;

  constructor(proxy: Proxy, controlHost: string, controlPort: number) {
    this._proxy = proxy;
    this._controlHost = controlHost;
    this._controlPort = controlPort;
  }

  get proxy(): Proxy {
    return this._proxy;
  }

  set proxy(value: Proxy) {
    this._proxy = value;
  }

  get controlHost(): string {
    return this._controlHost;
  }

  set controlHost(value: string) {
    this._controlHost = value;
  }

  get controlPort(): number {
    return this._controlPort;
  }

  set controlPort(value: number) {
    this._controlPort = value;
  }
}
