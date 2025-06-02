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

import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { HostInfo } from "../../host_info";
import { ClientWrapper } from "../../client_wrapper";
import { PluginService } from "../../plugin_service";
import { BlueGreenStatusProvider } from "./blue_green_status_provider";
import { BlueGreenStatus } from "./blue_green_status";
import { WrapperProperties } from "../../wrapper_property";
import { getTimeInNanos } from "../../utils/utils";
import { ConnectRouting } from "./routing/connect_routing";
import { IamAuthenticationPlugin } from "../../authentication/iam_authentication_plugin";
import { BlueGreenRole } from "./blue_green_role";
import { ExecuteRouting } from "./routing/execute_routing";

export interface BlueGreenProviderSupplier {
  create(pluginService: PluginService, props: Map<string, any>, bgdId: string): BlueGreenStatusProvider;
}

export class BlueGreenPlugin extends AbstractConnectionPlugin {
  private static readonly SUBSCRIBED_METHODS: Set<string> = new Set([
    // We should NOT subscribe to "forceConnect" pipeline since it's used by
    // BG monitoring, and we don't want to intercept/block those monitoring connections.
    "connect",
    "query"
  ]);

  private static readonly CLOSED_METHOD_NAMES: Set<string> = new Set(["end", "abort"]);
  protected readonly pluginService: PluginService;
  protected readonly properties: Map<string, any>;
  protected bgProviderSupplier: BlueGreenProviderSupplier;
  protected bgStatus: BlueGreenStatus = null;

  protected bgdId: string = null;
  protected isIamInUse: boolean = false;

  protected startTimeNano: bigint = BigInt(0);
  protected endTimeNano: bigint = BigInt(0);
  private static provider: Map<string, BlueGreenStatusProvider> = new Map();

  constructor(pluginService: PluginService, properties: Map<string, any>, bgProviderSupplier: BlueGreenProviderSupplier = null) {
    super();
    if (!bgProviderSupplier) {
      bgProviderSupplier = {
        create: (pluginService: PluginService, props: Map<string, any>, bgdId: string): BlueGreenStatusProvider => {
          return new BlueGreenStatusProvider(pluginService, props, bgdId);
        }
      };
    }

    this.properties = properties;
    this.pluginService = pluginService;
    this.bgProviderSupplier = bgProviderSupplier;
    this.bgdId = WrapperProperties.BGD_ID.get(this.properties).trim().toLowerCase();
  }

  getSubscribedMethods(): Set<string> {
    return BlueGreenPlugin.SUBSCRIBED_METHODS;
  }

  async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    this.resetRoutingTimeNano();

    try {
      this.bgStatus = this.pluginService.getStatus(BlueGreenStatus, this.bgdId);

      if (!this.bgStatus) {
        return this.regularOpenConnection(connectFunc, isInitialConnection);
      }

      if (isInitialConnection) {
        this.isIamInUse = this.pluginService.isPluginInUse(IamAuthenticationPlugin);
      }

      const hostRole: BlueGreenRole = this.bgStatus.getRole(hostInfo);

      if (!hostRole) {
        // Connection to a host that isn't participating in BG switchover.
        return this.regularOpenConnection(connectFunc, isInitialConnection);
      }

      let client: ClientWrapper | null = null;
      let routing: ConnectRouting | undefined = this.bgStatus.connectRouting.filter((routing: ConnectRouting) =>
        routing.isMatch(hostInfo, hostRole)
      )[0];

      if (!routing) {
        return this.regularOpenConnection(connectFunc, isInitialConnection);
      }

      this.startTimeNano = getTimeInNanos();
      while (routing && !client) {
        client = await routing.apply(this, hostInfo, props, isInitialConnection, connectFunc, this.pluginService);
        if (!client) {
          this.bgStatus = this.pluginService.getStatus<BlueGreenStatus>(BlueGreenStatus, this.bgdId);
          routing = this.bgStatus.connectRouting.filter((routing: ConnectRouting) => routing.isMatch(hostInfo, hostRole))[0];
        }
      }

      this.endTimeNano = getTimeInNanos();
      if (!client) {
        client = await connectFunc();
      }

      if (isInitialConnection) {
        // Provider should be initialized after connection is open and a dialect is properly identified.
        this.initProvider();
      }

      return client;
    } finally {
      if (this.startTimeNano > 0 && this.endTimeNano === BigInt(0)) {
        this.endTimeNano = getTimeInNanos();
      }
    }
  }

  async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    this.resetRoutingTimeNano();

    try {
      this.initProvider();

      if (BlueGreenPlugin.CLOSED_METHOD_NAMES.has(methodName)) {
        return await methodFunc();
      }

      this.bgStatus = this.pluginService.getStatus<BlueGreenStatus>(BlueGreenStatus, this.bgdId);

      if (!this.bgStatus) {
        return await methodFunc();
      }

      const currentHostInfo: HostInfo = this.pluginService.getCurrentHostInfo();
      const hostRole: BlueGreenRole = this.bgStatus.getRole(currentHostInfo);

      if (!hostRole) {
        // Connection to a host that isn't participating in BG switchover.
        return await methodFunc();
      }

      let result: T | null = null;
      let routing: ExecuteRouting | undefined = this.bgStatus.executeRouting.filter((routing: ExecuteRouting) =>
        routing.isMatch(currentHostInfo, hostRole)
      )[0];

      if (!routing) {
        return await methodFunc();
      }

      this.startTimeNano = getTimeInNanos();

      while (routing && !result) {
        result = await routing.apply(this, methodName, methodFunc, methodArgs, this.properties, this.pluginService);
        if (!result) {
          this.bgStatus = this.pluginService.getStatus<BlueGreenStatus>(BlueGreenStatus, this.bgdId);
          routing = this.bgStatus.executeRouting.filter((routing: ExecuteRouting) => routing.isMatch(currentHostInfo, hostRole))[0];
        }
      }

      this.endTimeNano = getTimeInNanos();

      if (!result) {
        return result;
      }

      return await methodFunc();
    } finally {
      if (this.startTimeNano > 0 && this.endTimeNano === BigInt(0)) {
        this.endTimeNano = getTimeInNanos();
      }
    }
  }

  protected async regularOpenConnection(connectFunc: () => Promise<ClientWrapper>, isInitialConnection: boolean) {
    const client: ClientWrapper = await connectFunc();
    if (isInitialConnection) {
      // Provider should be initialized after connection is open and a dialect is properly identified.
      this.initProvider();
    }

    return client;
  }

  private initProvider() {
    const provider = BlueGreenPlugin.provider.get(this.bgdId);
    if (!provider) {
      const provider = this.bgProviderSupplier.create(this.pluginService, this.properties, this.bgdId);
      BlueGreenPlugin.provider.set(this.bgdId, provider);
    }
  }

  public getHoldTimeNano(): bigint {
    return this.startTimeNano === BigInt(0)
      ? BigInt(0)
      : this.endTimeNano === BigInt(0)
        ? getTimeInNanos() - this.startTimeNano
        : this.endTimeNano - this.startTimeNano;
  }

  private resetRoutingTimeNano() {
    this.startTimeNano = BigInt(0);
    this.endTimeNano = BigInt(0);
  }
}
