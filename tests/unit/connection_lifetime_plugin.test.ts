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

import { jest } from "@jest/globals";
import { ConnectionLifetimePlugin } from "../../common/lib/plugins/connection_lifetime_plugin";
import { ConnectionLifetimePluginFactory } from "../../common/lib/plugins/connection_lifetime_plugin_factory";
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { HostInfo } from "../../common/lib/host_info";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { HostChangeOptions } from "../../common/lib/host_change_options";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { FullServicesContainer } from "../../common/lib/utils/full_services_container";
import {
  ConnectionLifetimeError,
  ConnectionLifetimeFailedError,
  ConnectionLifetimeSuccessError,
  FailoverSuccessError,
  IllegalArgumentError
} from "../../common/lib/utils/errors";
import { HostListProviderService } from "../../common/lib/host_list_provider_service";
import { OldConnectionSuggestionAction } from "../../common/lib/old_connection_suggestion_action";
import { Messages } from "../../common/lib/utils/messages";

const MS = 1_000_000n;
const LIFETIME_MS = 1000;

const hostBuilder = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() });
const originalHost: HostInfo = hostBuilder.withHost("cluster.example.com").withPort(5432).build();
const routedHost: HostInfo = hostBuilder.withHost("instance-2.example.com").withPort(5432).build();

type FakeClient = ClientWrapper & { end: jest.Mock<() => Promise<void>> };

function createClient(hostInfo: HostInfo = originalHost): FakeClient {
  return {
    client: {},
    hostInfo: hostInfo,
    properties: new Map(),
    id: "client",
    query: jest.fn(),
    queryWithTimeout: jest.fn(),
    rollback: jest.fn(),
    abort: jest.fn(),
    end: jest.fn(() => Promise.resolve())
  } as unknown as FakeClient;
}

// Holds the current client and transaction flag the way the plugin service does, and notifies the plugin of client
// switches so the plugin sees the same notification sequence as in a real chain.
class FakePluginService {
  readonly currentClient: { targetClient?: ClientWrapper } = {};
  inTransaction = false;
  initialConnectionHostInfo: HostInfo | null = originalHost;
  plugin?: ConnectionLifetimePlugin;
  evictClient = jest.fn((client: ClientWrapper) => true);
  connect = jest.fn<(hostInfo: HostInfo, props: Map<string, any>, pluginToSkip?: any) => Promise<ClientWrapper>>();
  setCurrentClient = jest.fn(async (client: ClientWrapper, hostInfo: HostInfo) => {
    await this.install(client);
    return new Set<HostChangeOptions>([HostChangeOptions.CONNECTION_OBJECT_CHANGED]);
  });

  getCurrentClient() {
    return this.currentClient;
  }

  isInTransaction(): boolean {
    return this.inTransaction;
  }

  getInitialConnectionHostInfo(): HostInfo | null {
    return this.initialConnectionHostInfo;
  }

  async install(client: ClientWrapper, changes: HostChangeOptions[] = [HostChangeOptions.CONNECTION_OBJECT_CHANGED]): Promise<void> {
    this.currentClient.targetClient = client;
    await this.plugin!.notifyConnectionChanged(new Set(changes));
  }
}

let now: bigint;
let pluginService: FakePluginService;
const methodFunc = jest.fn(() => Promise.resolve("result"));

function setMillis(millis: number) {
  now = BigInt(millis) * MS;
}

function createProps(lifetimeMs?: any, action?: any): Map<string, any> {
  const props = new Map<string, any>();
  if (lifetimeMs !== undefined) {
    props.set(WrapperProperties.CONNECTION_LIFETIME_MS.name, lifetimeMs);
  }
  if (action !== undefined) {
    props.set(WrapperProperties.CONNECTION_LIFETIME_ACTION.name, action);
  }
  return props;
}

function createPlugin(props: Map<string, any>): ConnectionLifetimePlugin {
  const container = { pluginService: pluginService } as unknown as FullServicesContainer;
  const plugin = new ConnectionLifetimePlugin(container, props, () => now);
  pluginService.plugin = plugin;
  return plugin;
}

function initializeOriginalHost(plugin: ConnectionLifetimePlugin) {
  plugin.initHostProvider(originalHost, new Map(), {} as HostListProviderService, () => {});
}

// Opens a client through the plugin's connect and installs it as the initial connection.
async function initializeConnection(plugin: ConnectionLifetimePlugin, client: ClientWrapper = createClient()): Promise<ClientWrapper> {
  await plugin.connect(originalHost, new Map(), true, () => Promise.resolve(client));
  await pluginService.install(client, [HostChangeOptions.INITIAL_CONNECTION]);
  return client;
}

async function createInitializedPlugin(action?: string): Promise<{ plugin: ConnectionLifetimePlugin; client: FakeClient }> {
  const plugin = createPlugin(createProps(LIFETIME_MS, action));
  initializeOriginalHost(plugin);
  const client = (await initializeConnection(plugin)) as FakeClient;
  return { plugin, client };
}

describe("connectionLifetimePluginTest", () => {
  beforeEach(() => {
    setMillis(0);
    pluginService = new FakePluginService();
    methodFunc.mockClear();
  });

  it("missing lifetime fails fast", () => {
    expect(() => createPlugin(createProps())).toThrow(IllegalArgumentError);
  });

  it.each([[0], [-1], [1.5], ["0"], ["-1"], ["abc"], ["1.5"], [""], [null], [true]])("invalid lifetime '%s' fails fast", (value) => {
    expect(() => createPlugin(createProps(value))).toThrow(IllegalArgumentError);
  });

  it.each([[1], ["1"], [" 300000 "]])("valid lifetime '%s' is accepted", (value) => {
    expect(() => createPlugin(createProps(value))).not.toThrow();
  });

  it.each([[""], ["invalid"], ["closed"], [null], [1]])("invalid action '%s' fails fast", (value) => {
    expect(() => createPlugin(createProps(LIFETIME_MS, value))).toThrow(IllegalArgumentError);
  });

  it("factory surfaces configuration errors unchanged", async () => {
    const container = { pluginService: pluginService } as unknown as FullServicesContainer;
    await expect(new ConnectionLifetimePluginFactory().getInstance(container, createProps())).rejects.toThrow(IllegalArgumentError);
  });

  it("subscribes only to network-bound and required lifecycle methods", () => {
    const methods = createPlugin(createProps(LIFETIME_MS)).getSubscribedMethods();
    for (const method of ["query", "execute", "commit", "rollback", "beginTransaction", "initHostProvider", "connect", "notifyConnectionChanged"]) {
      expect(methods.has(method)).toBe(true);
    }
    for (const method of ["end", "release", "destroy", "escape", "*"]) {
      expect(methods.has(method)).toBe(false);
    }
  });

  it("runs the call before expiration and acts at the exact boundary", async () => {
    const { plugin, client } = await createInitializedPlugin("close");

    setMillis(LIFETIME_MS - 1);
    await expect(plugin.execute("query", methodFunc, [])).resolves.toBe("result");
    expect(methodFunc).toHaveBeenCalledTimes(1);

    setMillis(LIFETIME_MS);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
    expect(methodFunc).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("close action closes before throwing and remains terminal", async () => {
    const { plugin, client } = await createInitializedPlugin(" CLOSE ");
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
    await expect(plugin.execute("commit", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);

    expect(methodFunc).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(pluginService.connect).not.toHaveBeenCalled();
    expect(plugin["connectionCreationTimes"].has(client)).toBe(false);
  });

  it("close action evicts the expired client before ending it", async () => {
    const { plugin, client } = await createInitializedPlugin("close");
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);

    expect(pluginService.evictClient).toHaveBeenCalledTimes(1);
    expect(pluginService.evictClient).toHaveBeenCalledWith(client);
    expect(pluginService.evictClient.mock.invocationCallOrder[0]).toBeLessThan(client.end.mock.invocationCallOrder[0]);
  });

  it("close action retains the close failure as the cause", async () => {
    const { plugin, client } = await createInitializedPlugin("close");
    const closeFailure = new Error("close failed");
    client.end.mockImplementation(() => Promise.reject(closeFailure));
    setMillis(LIFETIME_MS);

    const error = await plugin.execute("query", methodFunc, []).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectionLifetimeError);
    expect(error.cause).toBe(closeFailure);
  });

  it("terminal state does not block non-network methods", async () => {
    const { plugin } = await createInitializedPlugin("close");
    setMillis(LIFETIME_MS);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);

    await expect(plugin.execute("end", methodFunc, [])).resolves.toBe("result");
    await expect(plugin.execute("release", methodFunc, [])).resolves.toBe("result");
    expect(methodFunc).toHaveBeenCalledTimes(2);
  });

  it("non-network methods never trigger the action", async () => {
    const { plugin, client } = await createInitializedPlugin("close");
    setMillis(LIFETIME_MS * 10);

    await expect(plugin.execute("end", methodFunc, [])).resolves.toBe("result");
    await expect(plugin.execute("escape", methodFunc, [])).resolves.toBe("result");
    expect(client.end).not.toHaveBeenCalled();
  });

  it("connect timestamp is preserved through the initial notification", async () => {
    const plugin = createPlugin(createProps(LIFETIME_MS, "close"));
    const client = createClient();
    await plugin.connect(originalHost, new Map(), true, () => Promise.resolve(client));

    setMillis(600);
    await pluginService.install(client, [HostChangeOptions.INITIAL_CONNECTION]);

    setMillis(LIFETIME_MS);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
  });

  it("host-only notification does not reset the timestamp", async () => {
    const { plugin } = await createInitializedPlugin("close");

    setMillis(600);
    await plugin.notifyConnectionChanged(new Set([HostChangeOptions.HOSTNAME, HostChangeOptions.HOST_CHANGED]));

    setMillis(LIFETIME_MS);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
  });

  it("connection switched by another plugin uses its own creation time", async () => {
    const { plugin } = await createInitializedPlugin("close");

    // Another plugin opens a connection through the chain at 300 ms and installs it at 500 ms.
    setMillis(300);
    const switched = createClient(routedHost);
    await plugin.connect(routedHost, new Map(), false, () => Promise.resolve(switched));
    setMillis(500);
    await pluginService.install(switched);

    setMillis(LIFETIME_MS + 299);
    await expect(plugin.execute("query", methodFunc, [])).resolves.toBe("result");

    setMillis(LIFETIME_MS + 300);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
  });

  it("connection not seen through connect is timestamped on first notice", async () => {
    const { plugin } = await createInitializedPlugin("close");

    // The client is swapped without a notification; the first check at 500 ms starts its lifetime.
    setMillis(500);
    pluginService.currentClient.targetClient = createClient(routedHost);
    await expect(plugin.execute("query", methodFunc, [])).resolves.toBe("result");

    setMillis(LIFETIME_MS + 499);
    await expect(plugin.execute("query", methodFunc, [])).resolves.toBe("result");

    setMillis(LIFETIME_MS + 500);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
  });

  it("switching back to a cached connection retains its original creation time", async () => {
    const { plugin, client } = await createInitializedPlugin("close");

    setMillis(200);
    const other = createClient(routedHost);
    await pluginService.install(other);

    setMillis(800);
    await pluginService.install(client);

    setMillis(LIFETIME_MS);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(other.end).not.toHaveBeenCalled();
  });

  it("default reconnect uses the original host and does not run the pending call", async () => {
    const { plugin, client } = await createInitializedPlugin();

    // Routing moved the connection to another host; reconnect must still target the original host.
    const routed = createClient(routedHost);
    await pluginService.install(routed);

    const replacement = createClient();
    pluginService.connect.mockResolvedValue(replacement);
    setMillis(LIFETIME_MS);

    const error = await plugin.execute("query", methodFunc, []).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectionLifetimeSuccessError);
    expect(error).toBeInstanceOf(FailoverSuccessError);
    expect(error.message).toBe(Messages.get("ConnectionLifetimeSuccessError.connectionChanged"));
    expect(methodFunc).not.toHaveBeenCalled();
    expect(pluginService.connect).toHaveBeenCalledWith(originalHost, expect.any(Map), plugin);
    expect(pluginService.setCurrentClient).toHaveBeenCalledWith(replacement, originalHost);
    expect(pluginService.currentClient.targetClient).toBe(replacement);
    expect(client.end).not.toHaveBeenCalled();
  });

  it("reconnect evicts the superseded client before the switch and never the replacement", async () => {
    const { plugin, client } = await createInitializedPlugin();
    const replacement = createClient();
    pluginService.connect.mockResolvedValue(replacement);
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);

    expect(pluginService.evictClient).toHaveBeenCalledTimes(1);
    expect(pluginService.evictClient).toHaveBeenCalledWith(client);
    expect(pluginService.evictClient.mock.invocationCallOrder[0]).toBeLessThan(pluginService.setCurrentClient.mock.invocationCallOrder[0]);
    // A preserved client is only marked, never ended by the plugin.
    expect(client.end).not.toHaveBeenCalled();
  });

  it("reconnect uses the host captured at host provider initialization", async () => {
    const { plugin } = await createInitializedPlugin();

    // Plugins such as stale DNS later replace the initial connection host with the resolved instance.
    pluginService.initialConnectionHostInfo = routedHost;
    pluginService.connect.mockResolvedValue(createClient());
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);
    expect(pluginService.connect).toHaveBeenCalledWith(originalHost, expect.any(Map), plugin);
    expect(pluginService.setCurrentClient).toHaveBeenCalledWith(expect.anything(), originalHost);
  });

  it("reconnect falls back to the host provider host when no initial host is known", async () => {
    pluginService.initialConnectionHostInfo = null;
    const plugin = createPlugin(createProps(LIFETIME_MS));
    plugin.initHostProvider(routedHost, new Map(), {} as HostListProviderService, () => {});
    await initializeConnection(plugin);
    pluginService.connect.mockResolvedValue(createClient());
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);
    expect(pluginService.connect).toHaveBeenCalledWith(routedHost, expect.any(Map), plugin);
  });

  it("reconnect without a host provider initialization fails without connecting", async () => {
    const plugin = createPlugin(createProps(LIFETIME_MS));
    await initializeConnection(plugin);
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeFailedError);
    expect(pluginService.connect).not.toHaveBeenCalled();
    expect(methodFunc).not.toHaveBeenCalled();
  });

  it("explicit reconnect is case-insensitive and resets the timer after a successful switch", async () => {
    const { plugin } = await createInitializedPlugin(" Reconnect ");
    const replacement = createClient();
    pluginService.connect.mockResolvedValue(replacement);

    setMillis(LIFETIME_MS + 100);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);

    setMillis(LIFETIME_MS * 2 + 99);
    await expect(plugin.execute("query", methodFunc, [])).resolves.toBe("result");
    expect(pluginService.connect).toHaveBeenCalledTimes(1);

    setMillis(LIFETIME_MS * 2 + 100);
    pluginService.connect.mockResolvedValue(createClient());
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);
    expect(pluginService.connect).toHaveBeenCalledTimes(2);
  });

  it("reconnect failure keeps the cause and does not reset the timer", async () => {
    const { plugin } = await createInitializedPlugin();
    const connectFailure = new Error("connect failed");
    pluginService.connect.mockRejectedValue(connectFailure);
    setMillis(LIFETIME_MS);

    const error = await plugin.execute("query", methodFunc, []).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectionLifetimeFailedError);
    expect(error.cause).toBe(connectFailure);
    expect(pluginService.setCurrentClient).not.toHaveBeenCalled();
    // The expired client is still the one in use, so it must stay eligible for the pool.
    expect(pluginService.evictClient).not.toHaveBeenCalled();

    // The timer was not reset, so the next call tries to reconnect again.
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeFailedError);
    expect(pluginService.connect).toHaveBeenCalledTimes(2);
    expect(methodFunc).not.toHaveBeenCalled();
  });

  it("installation failure closes the unattached replacement and preserves the old timer", async () => {
    const { plugin, client } = await createInitializedPlugin();
    const replacement = createClient();
    const installFailure = new Error("install failed");
    pluginService.connect.mockResolvedValue(replacement);
    pluginService.setCurrentClient.mockRejectedValueOnce(installFailure);
    setMillis(LIFETIME_MS);

    const error = await plugin.execute("query", methodFunc, []).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectionLifetimeFailedError);
    expect(error.cause).toBe(installFailure);
    expect(replacement.end).toHaveBeenCalledTimes(1);
    expect(client.end).not.toHaveBeenCalled();
    expect(pluginService.currentClient.targetClient).toBe(client);
    expect(plugin["connectionCreationTimes"].has(replacement)).toBe(false);
    expect(plugin["connectionCreationTimes"].get(client)).toBe(0n);

    // The original client is still expired, so the next call tries again.
    pluginService.connect.mockResolvedValue(createClient());
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);
  });

  it("partial installation failure closes both connections and makes the plugin terminal", async () => {
    const { plugin, client } = await createInitializedPlugin();
    const replacement = createClient();
    const installFailure = new Error("session state failed");
    pluginService.connect.mockResolvedValue(replacement);
    pluginService.setCurrentClient.mockImplementationOnce(async (newClient: ClientWrapper) => {
      pluginService.currentClient.targetClient = newClient;
      throw installFailure;
    });
    setMillis(LIFETIME_MS);

    const error = await plugin.execute("query", methodFunc, []).catch((e) => e);
    expect(error).toBeInstanceOf(ConnectionLifetimeFailedError);
    expect(error.cause).toBe(installFailure);
    expect(replacement.end).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(pluginService.evictClient).toHaveBeenCalledWith(client);
    expect(pluginService.evictClient).not.toHaveBeenCalledWith(replacement);
    expect(plugin["connectionCreationTimes"].has(replacement)).toBe(false);
    expect(plugin["connectionCreationTimes"].has(client)).toBe(false);

    setMillis(0);
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
    expect(methodFunc).not.toHaveBeenCalled();
  });

  it("null replacement is reported as a reconnect failure", async () => {
    const { plugin } = await createInitializedPlugin();
    pluginService.connect.mockResolvedValue(null as unknown as ClientWrapper);
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeFailedError);
    expect(pluginService.setCurrentClient).not.toHaveBeenCalled();
  });

  it("transaction defers an expired reconnect through commit and rollback", async () => {
    const { plugin } = await createInitializedPlugin();
    pluginService.connect.mockResolvedValue(createClient());
    pluginService.inTransaction = true;
    setMillis(LIFETIME_MS * 3);

    await expect(plugin.execute("query", methodFunc, [])).resolves.toBe("result");
    await expect(plugin.execute("rollback", methodFunc, [])).resolves.toBe("result");
    await expect(plugin.execute("commit", methodFunc, [])).resolves.toBe("result");
    expect(pluginService.connect).not.toHaveBeenCalled();

    pluginService.inTransaction = false;
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);
    expect(methodFunc).toHaveBeenCalledTimes(3);
  });

  it("transaction defers an expired close through commit", async () => {
    const { plugin, client } = await createInitializedPlugin("close");
    pluginService.inTransaction = true;
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).resolves.toBe("result");
    await expect(plugin.execute("commit", methodFunc, [])).resolves.toBe("result");
    expect(client.end).not.toHaveBeenCalled();

    pluginService.inTransaction = false;
    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeError);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("concurrent expired calls share a single reconnect", async () => {
    const { plugin } = await createInitializedPlugin();
    let resolveConnect: (client: ClientWrapper) => void = () => {};
    pluginService.connect.mockImplementation(() => new Promise<ClientWrapper>((resolve) => (resolveConnect = resolve)));
    setMillis(LIFETIME_MS);

    const first = plugin.execute("query", methodFunc, []).catch((e) => e);
    const second = plugin.execute("query", methodFunc, []).catch((e) => e);
    resolveConnect(createClient());

    expect(await first).toBeInstanceOf(ConnectionLifetimeSuccessError);
    expect(await second).toBeInstanceOf(ConnectionLifetimeSuccessError);
    expect(pluginService.connect).toHaveBeenCalledTimes(1);
    expect(methodFunc).not.toHaveBeenCalled();
  });

  it("calls made on the replacement while it is being installed are not blocked", async () => {
    const { plugin } = await createInitializedPlugin();
    const replacement = createClient();
    pluginService.connect.mockResolvedValue(replacement);
    pluginService.setCurrentClient.mockImplementationOnce(async (newClient: ClientWrapper) => {
      await pluginService.install(newClient);
      // Session state is restored on the new client through the plugin chain before the switch completes.
      await plugin.execute("query", methodFunc, []);
      return new Set<HostChangeOptions>();
    });
    setMillis(LIFETIME_MS);

    await expect(plugin.execute("query", methodFunc, [])).rejects.toThrow(ConnectionLifetimeSuccessError);
    expect(methodFunc).toHaveBeenCalledTimes(1);
  });

  it("notification returns no opinion", async () => {
    const plugin = createPlugin(createProps(LIFETIME_MS));
    await expect(plugin.notifyConnectionChanged(new Set([HostChangeOptions.CONNECTION_OBJECT_CHANGED]))).resolves.toBe(
      OldConnectionSuggestionAction.NO_OPINION
    );
  });
});
