# Plugins As Loadable Modules

Plugins are loadable and extensible modules that add extra logic around executing method calls.

Plugins let users:

- monitor connections
- handle errors during executions
- log error details, such as SQL statements executed
- cache execution results
- measure execution time
- and more

The AWS Advanced NodeJS Wrapper has several built-in plugins; you can [see the list here](../using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#list-of-available-plugins).

## Available Services

Plugins are notified by the plugin manager when changes to the database connection occur, and utilize the [plugin service](./PluginService.md) to establish connections and retrieve host information.

## Using Custom Plugins

To use a custom plugin, you must:

1. Create a custom plugin.
2. Register the custom plugin to the PluginManager.
3. Specify the custom plugin to use in the plugins connection parameter.

### Creating Custom Plugins

There are two ways to create a custom plugin:

- implement the [ConnectionPlugin](../../common/lib/connection_plugin.ts) interface directly, or
- extend the [AbstractConnectionPlugin](../../common/lib/abstract_connection_plugin.ts) class.

The `AbstractConnectionPlugin` class provides a simple implementation for all the methods in `ConnectionPlugin`,
as it calls the provided method without additional operations. This is helpful when the custom plugin only needs to override one (or a few) methods from the `ConnectionPlugin` interface.
See the following classes for examples:

- [IamAuthenticationPlugin](../../common/lib/authentication/iam_authentication_plugin.ts)

  - The `IamAuthenticationPlugin` class only overrides the `connect` method because the plugin is only concerned with creating
    database connections with IAM database credentials.

- [ExecuteTimePlugin](../../common/lib/plugins/execute_time_plugin.ts)
  - The `ExecuteTimePlugin` only overrides the `execute` method because it is only concerned with elapsed time during execution, it does not establish new connections or set up any host list provider.

A `ConnectionPluginFactory` implementation is also required for the new custom plugin. This factory class is used to register and initialize custom plugins. See [ExecuteTimePluginFactory](../../common/lib/plugins/execute_time_plugin_factory.ts) for a simple implementation example.

### Subscribed Methods

The `getSubscribedMethods(): Set<string>` method specifies a set of methods a plugin is subscribed to. All plugins must implement the `getSubscribedMethods(): Set<string>` method.

When executing a method, the plugin manager will only call a specific plugin method if the method is within its set of subscribed methods. For example, the [IamAuthenticationPlugin](../../common/lib/authentication/iam_authentication_plugin.ts) only subscribes to methods relating to connection: the `connect` and `forceConnect` methods. This plugin will not be triggered by method calls like `isValid`.

Plugins can subscribe to any of the methods listed below:

- `connect`
- `forceConnect`
- `query`
- `initHostProvider`
- `notifyConnectionChanged`
- `notifyHostListChanged`
- `rollback`
- `end`

Plugins can subscribe to the following [pipelines](./Pipelines.md):

| Pipeline                                                                                            | Method Name / Subscription Key |
| --------------------------------------------------------------------------------------------------- | :----------------------------: |
| [Host provider pipeline](./Pipelines.md#host-provider-pipeline)                                     |        initHostProvider        |
| [Connect pipeline](./Pipelines.md#connect-pipeline)                                                 |            connect             |
| [Connection changed notification pipeline](./Pipelines.md#connection-changed-notification-pipeline) |    notifyConnectionChanged     |
| [Host list changed notification pipeline](./Pipelines.md#host-list-changed-notification-pipeline)   |     notifyHostListChanged      |

> [!TIP]
> A custom plugin can subscribe to all methods being executed, which means it may be active in every workflow.
> We recommend that you be aware of the performance impact of subscribing and performing demanding tasks for every method.

### Register the Custom Plugin

The Plugin Manager manages the creation of the plugin chain.
To register a new custom plugin, call `PluginManager.registerPlugin` as follows:

```ts
PluginManager.registerPlugin("foo", nameOfPluginFactory);
```

## What is Not Allowed in Plugins

When creating custom plugins, it is important to **avoid** the following bad practices in your plugin implementation:

1. Keeping local copies of shared information:
   - information like current connection, or the host list provider are shared across all plugins
   - shared information may be updated by any plugin at any time and should be retrieved via the plugin service when required
2. Using driver-specific properties or objects:
   - the AWS Advanced NodeJS Wrapper may be used with multiple drivers, therefore plugins must ensure implementation is not restricted to a specific driver
3. Making direct connections:
   - the plugin should always call the pipeline lambdas (i.e. `connectFunc: () => Promise<ClientWrapper>`, `methodFunc: () => Promise<T>`)
4. Running long tasks synchronously:
   - the method calls are executed by all subscribed plugins synchronously; if one plugin runs a long task during the execution it blocks the execution for the other plugins

See the following examples for more details:

<details><summary>❌ <strong>Bad Example</strong></summary>

```ts
export class BadPlugin extends AbstractConnectionPlugin {
  pluginService: PluginService;
  connectionProviderManager: ConnectionProviderManager;
  properties: Map<string, any>;
  hostListProvider: HostListProvider;

  constructor(pluginService: PluginService, connectionProviderManager: ConnectionProviderManager, properties: Map<string, any>) {
    this.pluginService = pluginService;
    this.connectionProviderManager = connectionProviderManager;
    this.properties = properties;

    // Bad Practice #1: keeping local copies of items
    // Plugins should not keep local copies of the host list provider, the topology or the connection.
    // Host list provider is kept in the Plugin Service and can be modified by other plugins,
    // therefore it should be retrieved by calling pluginService.getHostListProvider() when it is needed.
    this.hostListProvider = this.pluginService.getHostListProvider();
  }

  override getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);
  }

  override async connect<Type>(
    hostInfo: HostInfo,
    properties: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    // Bad Practice #2: using driver-specific objects.
    // Not all drivers support the same configuration parameters. For instance, while node-postgres supports
    // "connectionTimeoutMillis" as a connection property, node-mysql2 does not, it supports "connectTimeout".
    if (properties.get("connectionTimeoutMillis") == null) {
      properties.set("connectionTimeoutMillis", 60000);
    }

    // Bad Practice #3: Making direct connections
    return await this.connectionProviderManager.getConnectionProvider(hostInfo, properties).connect(hostInfo, this.pluginService, properties);
  }
}
```

</details>

<details><summary>✅ <strong>Good Example</strong></summary>

```ts
export class GoodExample extends AbstractConnectionPlugin {
  pluginService: PluginService;
  properties: Map<string, any>;

  constructor(pluginService: PluginService, properties: Map<string, any>) {
    this.pluginService = pluginService;
    this.properties = properties;
  }

  override getSubscribedMethods(): Set<string> {
    return new Set<string>(["*"]);
  }

  override async execute<Type>(methodName: string, methodFunc: () => Promise<T>, methodArgs: any[]): Promise<T> {
    if (this.pluginService.getHosts().length === 0) {
      // Re-fetch host information if it is empty.
      this.pluginService.forceRefreshHostList();
    }
    return await methodFunc();
  }

  override async connect<Type>(
    hostInfo: HostInfo,
    properties: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    if (WrapperProperties.USER.get(properties) === null) {
      WrapperProperties.USER.set(properties, "defaultUser");
    }

    return await connectFunc();
  }
}
```

</details>
