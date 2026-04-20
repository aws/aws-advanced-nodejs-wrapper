# Global Database (GDB) Read/Write Splitting Plugin

The GDB Read/Write Splitting plugin extends the functionality of the [read/write splitting plugin](./UsingTheReadWriteSplittingPlugin.md) and adopts some additional settings to improve support for Global Databases.

The GDB Read/Write Splitting plugin adds the notion of a home region and allows users to constrain new connections to this region. Such restrictions may be helpful to prevent opening new connections in environments where remote AWS regions add substantial latency that cannot be tolerated. 

Unless otherwise stated, all recommendations, configurations and code examples made for the [read/write splitting plugin](./UsingTheReadWriteSplittingPlugin.md) are applicable to the current GDB Read/Write Splitting plugin.

## Plugin Availability
The plugin is available since version 3.0.0.

## Loading the Global Database Read/Write Splitting Plugin

The GDB Read/Write Splitting plugin is not loaded by default. To load the plugin, include it in the `plugins` connection parameter. See the example below to properly load the GDB read/write splitting plugin with these plugins.

```typescript
const params = {
  plugins: "gdbReadWriteSplitting,failover2,efm2"
  // Add other connection properties below...
};

// If using MySQL:
const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:
const client = new AwsPGClient(params);
await client.connect();
```

If you would like to use the GDB read/write splitting plugin without the failover plugin, make sure you have the `gdbReadWriteSplitting` plugin in the `plugins` property, and that the failover plugin is not part of it.

```typescript
const params = {
  plugins: "gdbReadWriteSplitting"
  // Add other connection properties below...
};
```

> [!WARNING]
> Do not use the `readWriteSplitting` and `gdbReadWriteSplitting` plugins at the same time for the same connection!

## Using the GDB Read/Write Splitting Plugin against non-GDB clusters

The GDB Read/Write Splitting plugin can be used against Aurora clusters and RDS clusters. However, since these cluster types are single-region clusters, setting a home region does not make much sense. In these cases, use the original [Read/Write Splitting](./UsingTheReadWriteSplittingPlugin.md) plugin instead.

## Configuration Parameters

| Parameter                         | Value  |                                                                  Required                                                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                      | Default Value                                                                                                                    |
|-----------------------------------|:------:|:-------------------------------------------------------------------------------------------------------------------------------------------:|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `readerHostSelectorStrategy`      | `str`  |                                                                     No                                                                      | The name of the strategy that should be used to select a new reader host. For more information on the available reader selection strategies, see this [table](../ReaderSelectionStrategies.md).                                                                                                                                                                                                                  | `random`                                                                                                                         |
| `gdbRwHomeRegion`                 | `str`  | If connecting using an IP address, a custom domain URL, Global Database endpoint or other endpoint with no region: Yes<br><br>Otherwise: No | Defines a home region.<br><br>Examples: `us-west-2`, `us-east-1`. <br><br>If this parameter is omitted, the value is parsed from the connection configuration. For regional cluster endpoints and instance endpoints, it's set to the region of the provided endpoint. If the provided endpoint has no region (for example, a Global Database endpoint or IP address), the configuration parameter is mandatory. | For regional cluster endpoints and instance endpoints, it's set to the region of the provided endpoint.<br><br>Otherwise: `null` |
| `gdbRwRestrictWriterToHomeRegion` | `bool` |                                                                     No                                                                      | If set to `true`, prevents following and connecting to a writer node outside the defined home region. An exception will be raised when such a connection to a writer outside the home region is requested.                                                                                                                                                                                                       | `true`                                                                                                                           |
| `gdbRwRestrictReaderToHomeRegion` | `bool` |                                                                     No                                                                      | If set to `true`, prevents connecting to a reader node outside the defined home region. If no reader nodes in the home region are available, an exception will be raised.                                                                                                                                                                                                                                        | `true`                                                                                                                           |

Please refer to the original [Read/Write Splitting plugin](./UsingTheReadWriteSplittingPlugin.md) for more details about error codes, configurations, connection pooling and sample codes.
