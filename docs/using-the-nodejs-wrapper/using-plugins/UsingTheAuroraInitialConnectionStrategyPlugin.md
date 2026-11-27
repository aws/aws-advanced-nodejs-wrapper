# Aurora Initial Connection Strategy Plugin

The Aurora Initial Connection Strategy Plugin allows users to configure their initial connection strategy, and it can also be used to obtain a connection more reliably if DNS is updating by replacing an out of date endpoint. When the Aurora Initial Connection Strategy Plugin attempts to make a connection, it may retry the connection attempt if there is a failure. Users are able to configure how often to retry a connection and the maximum allowed time to obtain a connection using the connection parameters.

When this plugin is enabled, if the initial connection is to a reader cluster endpoint, the connected reader host will be chosen based on the configured strategy. The [initial connection strategy](../ReaderSelectionStrategies.md) specifies how the driver determines which available reader to connect to.

This plugin also helps retrieve connections more reliably. When a user connects to a cluster endpoint, the actual instance for a new connection is resolved by DNS. During failover, the cluster elects another instance to be the writer. While DNS is updating, which can take up to 40-60 seconds, if a user tries to connect to the cluster endpoint, they may be connecting to an old instance. This plugin helps by replacing the out of date endpoint if DNS is updating.

## Enabling the Aurora Initial Connection Strategy Plugin

Since version 2.1.1, the Aurora Initial Connection Strategy Plugin will be enabled by default if the [`plugins`](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) value is not specified. In earlier versions the plugin was not enabled by default. The Aurora Initial Connection Strategy Plugin can also be explicitly included by adding the plugin code `initialConnection` to the [`plugins`](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) connection parameter.

## Aurora Initial Connection Strategy Connection Parameters

The following properties can be used to configure the Aurora Initial Connection Strategy Plugin.

| Parameter                                           | Value  | Required | Description                                                                                                                                                                                                                                                                                             | Example            | Default Value |
| --------------------------------------------------- | :----: | :------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `readerHostSelectorStrategy`                        | string |    No    | The strategy that will be used to select a new reader host when opening a new connection. <br><br> For more information on the available reader selection strategies, see this [table](../ReaderSelectionStrategies.md).                                                                                | `leastConnections` | `random`      |
| `openConnectionRetryTimeoutMs`                      | number |    No    | The maximum allowed time for retries when opening a connection in milliseconds.                                                                                                                                                                                                                         | `40000`            | `30000`       |
| `openConnectionRetryIntervalMs`                     | number |    No    | The time between retries when opening a connection in milliseconds.                                                                                                                                                                                                                                     | `2000`             | `1000`        |
| `verifyOpenedConnectionType`                        | string |    No    | Controls whether the role of an opened connection is verified. Allowed values are `writer`, `reader` and `none`. Set to `none` to disable role verification. See [Disabling role verification](#disabling-role-verification).                                                                           | `none`             | `null`        |
| `verifyInactiveClusterWriterEndpointConnectionType` | string |    No    | Controls whether a connection opened through a writer cluster endpoint that may be inactive is verified to be a writer. Allowed values are `writer` and `none`. Applies only when `verifyOpenedConnectionType` is not set. See [Inactive writer cluster endpoints](#inactive-writer-cluster-endpoints). | `none`             | `writer`      |

## Disabling role verification

By default, the plugin checks that a newly opened connection has the expected role (writer or reader). If it does not, the plugin refreshes the topology, closes the connection and retries until `openConnectionRetryTimeoutMs` elapses. Each check requires a query on the new connection.

Setting `verifyOpenedConnectionType` to `none` turns off these role checks. With `none`:

- The plugin does not query the role of the opened connection, and it does not retry because of a role mismatch. This includes mismatches reported by the topology when connecting through a cluster endpoint.
- The plugin still uses the topology to choose an instance, applies the reader selection strategy and any accessible-region filtering, and retries if a connection attempt fails.
- The wrapper does not confirm the role of the connection after it is opened, so the role it records for the host may be out of date.
- A reader cluster endpoint can return a writer connection, for example while DNS is updating. Without role verification the plugin does not retry to obtain a reader.

Use `none` only if you want to avoid the role queries and can tolerate a connection whose role has not been confirmed.

> [!NOTE]
> `verifyOpenedConnectionType` applies only to role verification of newly opened connections. It does not change the role checks that failover plugins perform when selecting a new host.

### Inactive writer cluster endpoints

With an Aurora Global Database, the writer cluster endpoint in a secondary region is inactive and does not point to the current writer. The same is true when the topology is not yet available. When `verifyOpenedConnectionType` is not set, the plugin verifies the role of connections opened through a writer cluster endpoint as follows:

- If the topology writer is in the same region as the endpoint, the endpoint is active and the connection is always verified to be a writer.
- Otherwise, `verifyInactiveClusterWriterEndpointConnectionType` decides. `writer` (the default) verifies that the connection is a writer. `none` skips role verification.

An explicit `verifyOpenedConnectionType` always takes precedence over `verifyInactiveClusterWriterEndpointConnectionType`.

## Examples

Enabling the plugin:

```typescript
params = {
  plugins: "initialConnection"
  // Add additional connection parameters here
};

// If using MySQL:

const client = new AwsMySQLClient(params);
await client.connect();

// If using PostgreSQL:

const client = new AwsPgClient(params);
await client.connect();
```

Configuring the plugin using the connection parameters:

```typescript
params = {
  openConnectionRetryTimeoutMs: 40000
  // Add additional connection parameters here
};

// If using MySQL:

const client = new AwsMySQLClient(params);
await client.connect();

// If using PostgreSQL:

const client = new AwsPgClient(params);
await client.connect();
```
