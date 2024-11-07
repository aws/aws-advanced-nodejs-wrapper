## Read/Write Splitting Plugin

The Read/Write Splitting Plugin adds functionality to switch between writer and reader instances via calls to the `Client#setReadOnly` method. Upon calling `setReadOnly(true)`, the plugin will establish a connection to a reader instance and direct subsequent queries to this instance. Future `setReadOnly` calls will switch the underlying connection between the established writer and reader according to the `setReadOnly` value.

### Loading the Read/Write Splitting Plugin

The Read/Write Splitting Plugin is not loaded by default. To load the plugin, include `readWriteSplitting` in the [`plugins`](../../using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) connection parameter:

```typescript
params = {
  plugins: "readWriteSplitting,failover,efm"
  // Add other connection properties below...
};

// If using MySQL:

const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:

const client = new AwsPGClient(params);
await client.connect();
```

### Supplying the connection string

When using the Read/Write Splitting Plugin against Aurora clusters, you do not have to supply multiple instance URLs in the connection string. Instead, supply only the URL for the initial connection. The Read/Write Splitting Plugin will automatically discover the URLs for the other instances in the cluster and will use this info to switch between the writer/reader when `setReadOnly` is set.

> [!IMPORTANT]
> you must set the [`clusterInstanceHostPattern`](./UsingTheFailoverPlugin.md#failover-parameters) if you are connecting using an IP address or custom domain.

### Using the Read/Write Splitting Plugin against non-Aurora clusters

The Read/Write Splitting Plugin is not currently supported for non-Aurora clusters.

## Internal Connection Pooling

> [!WARNING]
> If internal connection pools are enabled, database passwords may not be verified with every connection request. The initial connection request for each database instance in the cluster will verify the password, but subsequent requests may return a cached pool connection without re-verifying the password. This behavior is inherent to the nature of connection pools in general and not a bug with the wrapper. `await ConnectionProviderManager.releaseResources()` can be called to close all pools and remove all cached pool connections. See [Internal Connection Pool Password Warning Example for Postgres](../../../examples/aws_driver_example/aws_interal_connection_pool_password_warning_postgres_example.ts) and [Internal Connection Pool Password Warning Example for MySQL](../../../examples/aws_driver_example/aws_internal_connection_pool_password_warning_mysql_example.ts)

Whenever `setReadOnly(true)` is first called on a `AwsClient` object, the read/write plugin will internally open a new physical connection to a reader. After this first call, the physical reader connection will be cached for the given `AwsClient`. Future calls to `setReadOnly` on the same `AwsClient` object will not require opening a new physical connection. However, calling `setReadOnly(true)` for the first time on a new `AwsClient` object will require the plugin to establish another new physical connection to a reader. If your application frequently calls `setReadOnly`, you can enable internal connection pooling to improve performance. When enabled, the wrapper driver will maintain an internal connection pool for each instance in the cluster. This allows the read/write splitting plugin to reuse connections that were established by `setReadOnly` calls on previous `AwsClient` objects.

> [!NOTE]
> Initial connections to a cluster URL will not be pooled. The driver does not pool cluster URLs because it can be problematic to pool a URL that resolves to different instances over time. The main benefit of internal connection pools is when setReadOnly is called. When setReadOnly is called (regardless of the initial connection URL), an internal pool will be created for the writer/reader that the plugin switches to and connections for that instance can be reused in the future.

The wrapper driver creates and maintain its internal connection pools using the AWS Pool Client. The steps are as follows:

1.  Create an instance of `InternalPooledConnectionProvider`. You can optionally pass in the set of pooled connection properties, otherwise the default properties will be used. Note that to follow desired behavior and ensure that the read/write plugin can internally establish connections to new instances, the connection properties below will be set by default and will override any values you set in the config parameter:

- url (including the host, port, and database)
- username
- password

The following internal pool connection parameters can be set. Note that some properties are driver-dependant, and if that property is set in a driver that cannot use it, the property will be ignored.

| MySQL Parameter      |  Value  | Required | Description                                                                                                                                                                                                                                                            | Default Value            |
| -------------------- | :-----: | :------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `maxConnections`     | Number  |    No    | The maximum number of connections to create.                                                                                                                                                                                                                           | `10`                     |
| `idleTimeoutMillis`  | Number  |    No    | The idle connections timeout, in milliseconds                                                                                                                                                                                                                          | `60000`                  |
| `maxIdleConnections` | Number  |    No    | The maximum number of idle connections. This property must be equal to or less than `maxConnections` or the `maxConnections` value will be used by default                                                                                                             | same as `maxConnections` |
| `waitForConnections` | Boolean |    No    | Determines the pool's action when no connections are available and the max connection limit has been reached. If true, the pool will queue the connection request and call it when one becomes available. If false, the pool will immediately call back with an error. | `true`                   |
| `queueLimit`         | Number  |    No    | The maximum number of connection requests the pool will queue before returning an error from getConnection. If set to 0, there is no limit to the number of queued connection requests.                                                                                | `0`                      |

> [!Note]
> In MySQL, if the number of connections in a pool exceeds maxConnections, the program will hang at the next connection attempt by default. You can set the `waitForConnections` parameter to `false`, which will cause the program to call back with an error.

| Postgres Parameter  |  Value  | Required | Description                                                                                                                        | Default Value |
| ------------------- | :-----: | :------: | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `maxConnections`    | Number  |    No    | The maximum number of connections to create                                                                                        | `10`          |
| `minConnections`    | Number  |    No    | The minumum number of connections to create                                                                                        | `0`           |
| `idleTimeoutMillis` | Number  |    No    | The idle connections timeout, in milliseconds                                                                                      | `60000`       |
| `allowExitOnIdle`   | Boolean |    No    | Setting `allowExitOnIdle: true` in the config will allow the pooled connection to exit as soon as all clients in the pool are idle | `false`       |

> [!Note]
> In Postgres, if the number of connections in a pool exceeds maxConnections, the program will hang at the next connection attempt. This is expected behaviour.

You can optionally pass in an `InternalPoolMapping` function as a second parameter to the `InternalPooledConnectionProvider`. This allows you to decide when new connection pools should be created by defining what is included in the pool map key. A new pool will be created each time a new connection is requested with a unique key. By default, a new pool will be created for each unique instance-user combination. If you would like to define a different key system, you should pass in a `InternalPoolMapping` function defining this logic. A simple example is show below. Please see [Internal Connection Pooling Postgres Example](../../../examples/aws_driver_example/aws_internal_connection_pooling_postgres_example.ts) and [Internal Connection Pooling MySQL Example](../../../examples/aws_driver_example/aws_internal_connection_pooling_mysql_example.ts) for the full examples.

```typescript
props.set("somePropertyValue", "1"); // used in getPoolKey

// Include the URL, user, and somePropertyValue in the connection pool key so that a new
// connection pool will be opened for each different instance-user-somePropertyValue
// combination.
const myPoolKeyFunc: InternalPoolMapping = {
  getPoolKey: (hostInfo: HostInfo, props: Map<string, any>) => {
    const user = props.get(WrapperProperties.USER.name);
    return hostInfo.url + user + props.get("somePropertyValue");
  }
};
const poolConfig = new AwsPoolConfig({ maxConnections: 10, idleTimeoutMillis: 10000 });
const provider = new InternalPooledConnectionProvider(poolConfig, myPoolKeyFunc);
ConnectionProviderManager.setConnectionProvider(provider);
```

> [!WARNING]
> If you do not include the username in your InternalPoolMapping function, connection pools may be shared between different users. As a result, an initial connection established with a privileged user may be returned to a connection request with a lower-privilege user without re-verifying credentials. This behavior is inherent to the nature of connection pools in general and not a bug with the driver. `await ConnectionProviderManager.releaseResources()` can be called to close all pools and remove all cached pool connections.

2. Call `ConnectionProviderManager.setConnectionProvider()`, passing in the `InternalPoolConnectionProvider` you created in Step 1.

3. By default, the read/write plugin randomly selects a reader instance the first time that `setReadOnly(true)` is called. If you would like the plugin to select a reader based on a different selection strategy, please see the [Reader Selection](#reader-selection) section for more information.

4. Continue as normal: create connections and use them as needed.

5. When you are finished using all connections, call `ConnectionProviderManager.releaseResources()`.

> [!IMPORTANT]
> You must call `await ConnectionProviderManager.releaseResources()` to close the internal connection pools when you are finished using all connections. Unless `await ConnectionProviderManager.releaseResources()` is called, the wrapper driver will keep the pools open so that they can be shared between connections.

### Reader Selection

To indicate which selection strategy to use, the `readerHostSelectorStrategy` configuration parameter can be set to one of the selection strategies in this [table](../ReaderSelectionStrategies.md). The following is an example of enabling the least connections strategy:

```typescript
props.set(WrapperProperties.READER_HOST_SELECTOR_STRATEGY.name, "leastConnections");
```

### Connection Strategies

By default, the Read/Write Splitting Plugin randomly selects a reader instance the first time `setReadOnly(true)` is called. To balance connections to reader instances more evenly, different connection strategies can be used. The following table describes the currently available connection strategies and any relevant configuration parameters for each strategy.

To indicate which connection strategy to use, the `readerHostSelectorStrategy` parameter can be set to one of the [reader host selection strategies](../ReaderSelectionStrategies.md). The following is an example of enabling the `random` strategy:

```typescript
params = {
  readerHostSelectorStrategy: "random"
  // Add other connection properties below...
};

// If using MySQL:

const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:

const client = new AwsPGClient(params);
await client.connect();
```
