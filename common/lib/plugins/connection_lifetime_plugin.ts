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

import { logger } from "../../logutils";
import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { ClientWrapper } from "../client_wrapper";
import { HostChangeOptions } from "../host_change_options";
import { HostInfo } from "../host_info";
import { HostListProviderService } from "../host_list_provider_service";
import { OldConnectionSuggestionAction } from "../old_connection_suggestion_action";
import { PluginService } from "../plugin_service";
import {
  AwsWrapperError,
  ConnectionLifetimeError,
  ConnectionLifetimeFailedError,
  ConnectionLifetimeSuccessError,
  IllegalArgumentError
} from "../utils/errors";
import { FullServicesContainer } from "../utils/full_services_container";
import { Messages } from "../utils/messages";
import { SubscribedMethodHelper } from "../utils/subscribed_method_helper";
import { getTimeInNanos } from "../utils/utils";
import { WrapperProperties } from "../wrapper_property";

type LifetimeAction = "close" | "reconnect";

const LIFETIME_ACTIONS: readonly LifetimeAction[] = ["close", "reconnect"];

export class ConnectionLifetimePlugin extends AbstractConnectionPlugin {
  private static readonly NETWORK_BOUND_METHODS: ReadonlySet<string> = new Set<string>(SubscribedMethodHelper.NETWORK_BOUND_METHODS);
  private static readonly SUBSCRIBED_METHODS: Set<string> = new Set<string>([
    ...SubscribedMethodHelper.NETWORK_BOUND_METHODS,
    "initHostProvider",
    "connect",
    "notifyConnectionChanged"
  ]);

  private readonly pluginService: PluginService;
  private readonly properties: Map<string, any>;
  private readonly nanoTime: () => bigint;
  private readonly connectionLifetimeNanos: bigint;
  private readonly action: LifetimeAction;

  // Keyed by client identity. A WeakMap lets clients that are dropped after a switch be collected together with their
  // timestamp, so the map does not grow over a long-lived application connection.
  private readonly connectionCreationTimes = new WeakMap<ClientWrapper, bigint>();

  private originalHostInfo: HostInfo | null = null;
  private timedClient: ClientWrapper | null = null;
  private timedClientCreationTime: bigint | null = null;
  private terminal: boolean = false;
  private pendingReconnect: { expiredClient: ClientWrapper | null; outcome: Promise<AwsWrapperError> } | null = null;

  constructor(servicesContainer: FullServicesContainer, properties: Map<string, any>, nanoTime: () => bigint = getTimeInNanos) {
    super();
    this.pluginService = servicesContainer.pluginService;
    this.properties = properties;
    this.nanoTime = nanoTime;
    this.connectionLifetimeNanos = BigInt(ConnectionLifetimePlugin.getConnectionLifetimeMs(properties)) * 1_000_000n;
    this.action = ConnectionLifetimePlugin.getLifetimeAction(properties);
  }

  private static getConnectionLifetimeMs(properties: Map<string, any>): number {
    const value = WrapperProperties.CONNECTION_LIFETIME_MS.get(properties);
    const lifetimeMs = typeof value === "string" && /^\s*\+?\d+\s*$/.test(value) ? Number(value) : value;
    if (typeof lifetimeMs !== "number" || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1) {
      throw new IllegalArgumentError(Messages.get("ConnectionLifetimePlugin.invalidConnectionLifetime", String(value)));
    }
    return lifetimeMs;
  }

  private static getLifetimeAction(properties: Map<string, any>): LifetimeAction {
    const value = WrapperProperties.CONNECTION_LIFETIME_ACTION.get(properties);
    const action = typeof value === "string" ? value.trim().toLowerCase() : value;
    const match = LIFETIME_ACTIONS.find((candidate) => candidate === action);
    if (!match) {
      throw new IllegalArgumentError(Messages.get("ConnectionLifetimePlugin.invalidConnectionLifetimeAction", String(value)));
    }
    return match;
  }

  override getSubscribedMethods(): Set<string> {
    return ConnectionLifetimePlugin.SUBSCRIBED_METHODS;
  }

  override initHostProvider(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostListProviderService: HostListProviderService,
    initHostProviderFunc: () => void
  ): void {
    initHostProviderFunc();
    // Reconnect targets the host the application asked for, never a host later chosen by routing or failover.
    this.originalHostInfo = this.pluginService.getInitialConnectionHostInfo() ?? hostInfo;
  }

  override async connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    const client = await connectFunc();
    if (client) {
      this.connectionCreationTimes.set(client, this.nanoTime());
    }
    return client;
  }

  override notifyConnectionChanged(changes: Set<HostChangeOptions>): Promise<OldConnectionSuggestionAction> {
    if (changes.has(HostChangeOptions.INITIAL_CONNECTION) || changes.has(HostChangeOptions.CONNECTION_OBJECT_CHANGED)) {
      this.selectCurrentClientTimestamp();
    }
    return Promise.resolve(OldConnectionSuggestionAction.NO_OPINION);
  }

  override async execute<T>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    if (!ConnectionLifetimePlugin.NETWORK_BOUND_METHODS.has(methodName)) {
      return await methodFunc();
    }

    if (this.terminal) {
      throw new ConnectionLifetimeError();
    }

    if (this.pendingReconnect && this.pendingReconnect.expiredClient === this.pluginService.getCurrentClient().targetClient) {
      // Another call already started replacing this expired connection; report its outcome instead of opening a
      // second replacement. Calls made on the replacement while it is being installed are not held here.
      throw await this.pendingReconnect.outcome;
    }

    if (!this.isCurrentClientExpired()) {
      return await methodFunc();
    }

    if (this.pluginService.isInTransaction()) {
      // Closing or switching mid-transaction would lose the transaction. Let it finish; the action runs on the first
      // network-bound call after the transaction ends.
      logger.debug(Messages.get("ConnectionLifetimePlugin.actionDeferred", methodName));
      return await methodFunc();
    }

    if (this.action === "close") {
      throw await this.closeCurrentClient();
    }

    const pendingReconnect = { expiredClient: this.pluginService.getCurrentClient().targetClient ?? null, outcome: this.reconnect() };
    this.pendingReconnect = pendingReconnect;
    try {
      throw await pendingReconnect.outcome;
    } finally {
      if (this.pendingReconnect === pendingReconnect) {
        this.pendingReconnect = null;
      }
    }
  }

  private selectCurrentClientTimestamp(): void {
    const currentClient = this.pluginService.getCurrentClient().targetClient;
    if (!currentClient) {
      this.timedClient = null;
      this.timedClientCreationTime = null;
      return;
    }

    let creationTime = this.connectionCreationTimes.get(currentClient);
    if (creationTime === undefined) {
      creationTime = this.nanoTime();
      this.connectionCreationTimes.set(currentClient, creationTime);
    }

    this.timedClient = currentClient;
    this.timedClientCreationTime = creationTime;
  }

  private isCurrentClientExpired(): boolean {
    const currentClient = this.pluginService.getCurrentClient().targetClient;
    if (currentClient !== this.timedClient || this.timedClientCreationTime === null) {
      this.selectCurrentClientTimestamp();
    }

    return this.timedClientCreationTime !== null && this.nanoTime() - this.timedClientCreationTime >= this.connectionLifetimeNanos;
  }

  private async closeCurrentClient(): Promise<ConnectionLifetimeError> {
    // Set before the first await so concurrent calls on this client fail instead of reaching the closing connection.
    this.terminal = true;
    const currentClient = this.pluginService.getCurrentClient().targetClient;
    if (!currentClient) {
      return new ConnectionLifetimeError();
    }

    logger.debug(Messages.get("ConnectionLifetimePlugin.closing", currentClient.hostInfo?.hostAndPort ?? "<null>"));
    this.connectionCreationTimes.delete(currentClient);
    // Ending a client from an internal pool only returns it to the pool, where it would be handed out again.
    this.pluginService.evictClient(currentClient);
    try {
      await currentClient.end();
    } catch (error: any) {
      logger.warn(Messages.get("ConnectionLifetimePlugin.closeConnectionFailed", error?.message));
      return new ConnectionLifetimeError(error);
    }
    return new ConnectionLifetimeError();
  }

  private async reconnect(): Promise<AwsWrapperError> {
    const previousClient = this.pluginService.getCurrentClient().targetClient ?? null;
    let replacementClient: ClientWrapper | null = null;
    try {
      const reconnectHostInfo = this.originalHostInfo;
      if (!reconnectHostInfo) {
        throw new AwsWrapperError(Messages.get("ConnectionLifetimePlugin.originalHostUnavailable"));
      }

      logger.debug(Messages.get("ConnectionLifetimePlugin.reconnecting", reconnectHostInfo.hostAndPort));
      replacementClient = await this.pluginService.connect(reconnectHostInfo, this.properties, this);
      if (!replacementClient) {
        throw new AwsWrapperError(Messages.get("ConnectionLifetimePlugin.reconnectReturnedNull"));
      }
      const replacementCreationTime = this.nanoTime();

      if (previousClient) {
        // The plugin service ends the superseded client during the switch, and a released pooled connection can go to
        // another caller at once, so mark it first. A client another plugin preserves stays open until its holder ends it.
        this.pluginService.evictClient(previousClient);
      }
      await this.pluginService.setCurrentClient(replacementClient, reconnectHostInfo);

      // The timer restarts only once the replacement is the client in use.
      this.connectionCreationTimes.set(replacementClient, replacementCreationTime);
      this.timedClient = replacementClient;
      this.timedClientCreationTime = replacementCreationTime;
      logger.debug(Messages.get("ConnectionLifetimePlugin.reconnected", reconnectHostInfo.hostAndPort));
    } catch (error: any) {
      logger.debug(Messages.get("ConnectionLifetimePlugin.reconnectFailed", error?.message));
      await this.cleanupFailedReplacement(replacementClient, previousClient);
      return new ConnectionLifetimeFailedError(error);
    }

    return new ConnectionLifetimeSuccessError();
  }

  private async cleanupFailedReplacement(replacementClient: ClientWrapper | null, previousClient: ClientWrapper | null): Promise<void> {
    if (!replacementClient) {
      return;
    }

    const currentClient = this.pluginService.getCurrentClient().targetClient;
    if (replacementClient === currentClient && replacementClient !== previousClient) {
      // The replacement was installed but the switch did not complete, so neither connection is in a known state.
      this.terminal = true;
      await this.closeClient(replacementClient, "ConnectionLifetimePlugin.failedInstallationConnectionCloseFailed");
      await this.closeClient(previousClient, "ConnectionLifetimePlugin.failedInstallationConnectionCloseFailed");
      return;
    }

    if (replacementClient !== currentClient) {
      // The replacement never became the current client; close it so it does not leak.
      await this.closeClient(replacementClient, "ConnectionLifetimePlugin.replacementCloseFailed");
    }
  }

  private async closeClient(client: ClientWrapper | null, failureMessageKey: string): Promise<void> {
    if (!client) {
      return;
    }

    this.connectionCreationTimes.delete(client);
    try {
      await client.end();
    } catch (error: any) {
      logger.warn(Messages.get(failureMessageKey, error?.message));
    }
  }
}
