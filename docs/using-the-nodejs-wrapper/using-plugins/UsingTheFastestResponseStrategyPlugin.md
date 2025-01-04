## Fastest Response Strategy Plugin

The Fastest Response Strategy Plugin is a host selection strategy plugin that monitors the response time of each reader host, and returns the host with the fastest response time. The plugin stores the fastest host in a cache so it can easily be retrieved again.

The host response time is measured at an interval set by `responseMeasurementIntervalMs`, at which time the old cache expires and is updated with the current fastest host.

## Using the Fastest Response Strategy Plugin

The plugin can be loaded by adding the plugin code `FastestResponseStrategy` to the [`plugins`](../UsingTheNodeJsWrapper#aws-advanced-nodejs-wrapper-parameters) parameter. The Fastest Response Strategy Plugin is not loaded by default, and must be loaded along with the [`readWriteSplitting`](./UsingTheReadWriteSplittingPlugin.md) plugin.

> [!IMPORTANT]\
> **The `readerHostSelectorStrategy` parameter must be set to `fastestReponse` when using this plugin, otherwise an error will be thrown:**
> `Unsupported host selector strategy: 'random'. To use the fastest response strategy plugin, please ensure the property readerHostSelectorStrategy is set to 'fastestResponse'.`

```ts
params = {
  plugins: "readWriteSplitting,fastestResponseStrategy,failover,efm",
  readerHostSelectorStrategy: "fastestResponse"
  // Add other connection properties below...
};

// If using MySQL:
const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:
const client = new AwsPGClient(params);
await client.connect();
```

## Configuration Parameters

| Parameter                       |  Value   | Required | Description                                                                                                                              | Default Value |
| ------------------------------- | :------: | :------: | :--------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `readerHostSelectorStrategy`    | `string` |   Yes    | Setting to `fastestReponse` sets the reader host selector strategy to choose the fastest host using the Fastest Response Strategy Plugin. | `random`      |
| `responseMeasurementIntervalMs` | `number` |    No    | Interval in milliseconds between measuring response time to a database host.                                                              | `30_000`      |

## Host Response Time Monitor

The Host Response Time Monitor measures the host response time in a separate monitoring thread. If the monitoring thread has not been called for a response time for 10 minutes, the thread is stopped. When the topology changes, the new hosts will be added to monitoring.

The host response time monitoring thread creates new database connections. By default it uses the same set of connection parameters provided for the main connection, but you can customize these connections with the `frt-` prefix, as in the following example:

```ts
const client = new AwsMySQLClient({
  user: "john",
  password: "pwd",
  host: "database.cluster-xyz.us-east-1.rds.amazonaws.com",
  database: "mysql",
  port: 3306,
  plugins: "readWriteSplitting,fastestResponseStrategy",
  readerHostSelectorStrategy: "fastestResponse"
  // Configure the timeout values for all non-monitoring connections.
  connectTimeout: 30
  // Configure different timeout values for the host response time monitoring connection.
  frt_connectTimeout: 10
    });
```

> [!IMPORTANT]\
> **When specifying a frt\_ prefixed timeout, always ensure you provide a non-zero timeout value.**

### Sample Code

[PostgreSQL fastest response strategy sample code](../../../examples/aws_driver_example/fastest_response_strategy_postgres_example.ts)<br>
[MySQL fastest response strategy sample code](../../../examples/aws_driver_example/fastest_response_strategy_mysql_example.ts)
