## Read/Write Splitting Plugin

The Read/Write Splitting Plugin adds functionality to switch between writer and reader instances via calls to the `Client#setReadOnly` method. Upon calling `setReadOnly(true)`, the plugin will establish a connection to a reader instance and direct subsequent queries to this instance. Future `setReadOnly` calls will switch the underlying connection between the established writer and reader according to the `setReadOnly` value.

### Loading the Read/Write Splitting Plugin

The Read/Write Splitting Plugin is not loaded by default. To load the plugin, include `readWriteSplitting` in the [`plugins`](../UsingTheNodejsDriver.md#connection-plugin-manager-parameters) connection parameter:

```typescript
params = {
    plugins: "readWriteSplitting,failover,hostMonitoring" 
    // Add other connection properties below...
}

// If using MySQL:

const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:

const client = new AwsPGClient(params);
await client.connect();

### Supplying the connection string

When using the Read/Write Splitting Plugin against Aurora clusters, you do not have to supply multiple instance URLs in the connection string. Instead, supply only the URL for the initial connection. The Read/Write Splitting Plugin will automatically discover the URLs for the other instances in the cluster and will use this info to switch between the writer/reader when `setReadOnly` is set.

> [!IMPORTANT]\
> you must set the [`clusterInstanceHostPattern`](./UsingTheFailoverPlugin.md#failover-parameters) if you are connecting using an IP address or custom domain.

### Using the Read/Write Splitting Plugin against non-Aurora clusters

The Read/Write Splitting Plugin is not currently supported for non-Aurora clusters.

### Connection Strategies
By default, the Read/Write Splitting Plugin randomly selects a reader instance the first time `setReadOnly(true)` is called. To balance connections to reader instances more evenly, different connection strategies can be used. The following table describes the currently available connection strategies and any relevant configuration parameters for each strategy.

To indicate which connection strategy to use, the `readerHostSelectorStrategy` parameter can be set to one of the connection strategies in the table below. The following is an example of enabling the `random` strategy:

```typescript
params = {
    "readerHostSelectorStrategy": "random",
    // Add other connection properties below...
}

// If using MySQL:

const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:

const client = new AwsPGClient(params);
await client.connect();
```

| Connection Strategy             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Default Value                                                                                              |
|---------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| `random`                        | The random strategy is the default connection strategy. When switching to a reader connection, the reader instance will be chosen randomly from the available database instances.                                                                                                                                                                                                                                                                                                                                                                                 | N/A                                                                                                        |
