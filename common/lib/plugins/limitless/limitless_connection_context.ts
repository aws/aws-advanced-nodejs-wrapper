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
import { ConnectionPlugin } from "../../connection_plugin";
import Map from "@arrows/array/src/map";

export class LimitlessConnectionContext {
  private readonly hostInfo: HostInfo;
  private readonly props: Map<string, any>;
  private connection: ClientWrapper | null;
  private readonly connectFunc: () => Promise<ClientWrapper>;
  private routers: HostInfo[] | null;
  private plugin: ConnectionPlugin;
  private connectionHostInfo: HostInfo | null;

  constructor(
    hostInfo: HostInfo,
    props: Map<string, any>,
    connection: ClientWrapper | null,
    connectFunc: () => Promise<ClientWrapper>,
    routers: HostInfo[] | null,
    plugin: ConnectionPlugin
  ) {
    this.hostInfo = hostInfo;
    this.props = props;
    this.connection = connection;
    this.connectFunc = connectFunc;
    this.routers = routers;
    this.plugin = plugin;
    this.connectionHostInfo = null;
  }

  public getHostInfo(): HostInfo {
    return this.hostInfo;
  }

  public getProperties(): Map<string, any> {
    return this.props;
  }

  public getConnection(): ClientWrapper | null {
    return this.connection;
  }

  public getConnectFunc(): () => Promise<ClientWrapper> {
    return this.connectFunc;
  }

  getConnectionHostInfo(): HostInfo | null {
    return this.connectionHostInfo;
  }

  setConnectionHostInfo(value: HostInfo | null) {
    this.connectionHostInfo = value;
  }

  public getRouters(): HostInfo[] | null {
    return this.routers;
  }

  public setConnection(connection: ClientWrapper) {
    this.connection = connection;
  }

  public setRouters(routers: HostInfo[]) {
    this.routers = routers;
  }

  public getPlugin(): ConnectionPlugin {
    return this.plugin;
  }
}
