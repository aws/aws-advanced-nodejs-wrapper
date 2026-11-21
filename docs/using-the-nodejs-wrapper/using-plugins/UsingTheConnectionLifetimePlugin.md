# Connection Lifetime Plugin

The Connection Lifetime Plugin limits how long the AWS Advanced NodeJS Wrapper uses a physical database connection.
When an expired connection is about to make a network-bound call, the plugin either closes the connection or reconnects to the host originally supplied by the application.

## Enabling the Connection Lifetime Plugin

Add the plugin code `connectionLifetime` to the [`plugins`](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) value.
The `connectionLifetimeMs` parameter is required.

```typescript
import { AwsPgClient } from "aws-advanced-nodejs-wrapper/pg";

const client = new AwsPgClient({
  host: "db-identifier.cluster-XYZ.us-east-2.rds.amazonaws.com",
  port: 5432,
  user: "username",
  password: "password",
  database: "postgres",
  plugins: "connectionLifetime",
  connectionLifetimeMs: 300000
});
```

When `autoSortWrapperPluginOrder` is enabled, which is the default, the plugin is placed before every other plugin in the chain.

## Configuration Parameters

| Parameter                  |  Value   | Required | Description                                                                                                                               | Default Value |
| -------------------------- | :------: | :------: | :---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `connectionLifetimeMs`     | `number` |   Yes    | Maximum physical connection lifetime in milliseconds. The value must be a whole number of at least `1`.                                   | None          |
| `connectionLifetimeAction` | `string` |    No    | Action taken after the connection expires. Accepted values are `reconnect` and `close`, ignoring letter case and surrounding white space. | `reconnect`   |

A missing or invalid `connectionLifetimeMs` value, or an unsupported `connectionLifetimeAction` value, raises an `IllegalArgumentError` when `connect()` is called.

## Expiration Checks

The lifetime starts when a physical connection is created.
A connection the plugin did not see being created, for example one opened while the plugin was skipped, is timestamped when the plugin first notices it.
A connection is expired when its elapsed lifetime is greater than or equal to `connectionLifetimeMs`.
The boundary is inclusive, so a connection with a configured lifetime of 1000 ms is expired at exactly 1000 ms.

The plugin checks the lifetime immediately before network-bound calls such as `query`, `execute`, `beginTransaction`, `commit` and `rollback`.
It does not run a background timer.
An expired connection therefore stays open until the next network-bound call triggers the configured action.

Lifecycle and local calls, such as `end`, `release` and the `escape` helpers, never trigger the action.

The plugin applies only to the connection used by the application.
Internal connections opened by other plugins, such as monitoring or topology connections, have their own lifecycle and are not tracked.

The configured action runs before the pending call.
The pending call is not executed when the plugin closes or reconnects the connection.

## Close Action

With `connectionLifetimeAction` set to `close`, the plugin closes the current physical connection and throws a `ConnectionLifetimeError`.
If closing the connection fails, the failure is available as the error's `cause`.

The client remains permanently unusable after this error.
Every later network-bound call throws `ConnectionLifetimeError`.
The application should call `end()` and create a new client.

## Reconnect Action

With the default `connectionLifetimeAction` of `reconnect`, the plugin opens a replacement physical connection to the host and port the application originally supplied.
It does not use a host selected later by read/write splitting, failover or another plugin.
The replacement becomes the client's current connection, and the lifetime is reset only after that switch succeeds.

After a successful reconnect, the plugin throws a `ConnectionLifetimeSuccessError`.
The client already holds the replacement connection, but the pending call was not executed.
Reconfigure any session state that is not transferred automatically, then retry the operation.

`ConnectionLifetimeSuccessError` extends `FailoverSuccessError`, so application code that already retries after a [successful failover](./UsingTheFailoverPlugin.md#failoversuccesserror) also retries after a successful reconnect.

If opening or installing the replacement connection fails, the plugin throws a `ConnectionLifetimeFailedError`, with the original failure available as its `cause`.
The lifetime is not reset, so the next network-bound call tries to reconnect again.
If the replacement was installed but the switch did not complete, the plugin closes both connections and later network-bound calls throw `ConnectionLifetimeError`.

When several calls are in flight on the same client at the moment it expires, the plugin opens a single replacement connection and every one of those calls receives the outcome of that reconnect.

## Transactions

Neither action runs while a transaction is active.
If the lifetime expires during a transaction, network-bound calls continue on the current physical connection, so `commit` and `rollback` complete normally.
Deferral does not extend or reset the lifetime.

After the transaction ends, the first network-bound call runs the configured action before that call.

## Error Handling

| Error                            | Client Usable Afterwards | What To Do                                                                     |
| -------------------------------- | :----------------------: | ------------------------------------------------------------------------------ |
| `ConnectionLifetimeSuccessError` |           Yes            | Reconfigure session state if required and retry the pending operation.         |
| `ConnectionLifetimeFailedError`  |        Not always        | Retry later, or call `end()` and create a new client if the error is repeated. |
| `ConnectionLifetimeError`        |            No            | Call `end()` and create a new client.                                          |

All three errors are exported from the wrapper package.

```typescript
import { ConnectionLifetimeError, ConnectionLifetimeSuccessError } from "aws-advanced-nodejs-wrapper";

try {
  await client.query("SELECT 1");
} catch (error) {
  if (error instanceof ConnectionLifetimeSuccessError) {
    // The client now holds a new connection. Retry the query.
    await client.query("SELECT 1");
  } else if (error instanceof ConnectionLifetimeError) {
    // The client was closed. Create a new client.
  } else {
    throw error;
  }
}
```

## Connection Pooling

The plugin measures the lifetime of the connection held by one client.
With the [AWS pool clients](../UsingTheConnectionPool.md) (`AwsPgPoolClient` and `AwsMySQLPoolClient`), each connection taken from the pool is a new client with its own plugin chain.
With [internal connection pooling](./UsingTheReadWriteSplittingPlugin.md#internal-connection-pooling), each connection is taken from the pool when the client connects to a host.
In both cases the lifetime is measured from the time the connection was taken from the pool rather than from the time the physical connection was opened.
When the plugin ends an expired connection taken from either pool, it closes the physical connection and removes it from the pool, so the pool does not hand it out again.
A connection taken from the pool may already be older than `connectionLifetimeMs`.
To bound the age of pooled physical connections, use the pool's own settings, such as `maxLifetimeSeconds` for PostgreSQL.
