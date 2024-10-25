# Pipelines

<div style="center"><img src="../images/pipelines.png" alt="diagram for the plugin service design"/></div>

A plugin pipeline is an execution workflow achieving a specific goal.

The plugin pipelines available in the driver are:

- The connect pipeline.
- The force connect pipeline
- The execute pipeline.
- The host provider pipeline.
- The connection changed notification pipeline.
- The host list changed notification pipeline.
- The accepts strategy pipeline.
- The get HostInfo by strategy pipeline.
- The release resources pipeline.

A plugin does not need to implement all pipelines. A plugin can implement one or more pipelines depending on its functionality.

For information on how to subscribe to these pipelines, please see the documentation on [subscribed methods](./LoadablePlugins.md#subscribed-methods).

## Connect Pipeline

The connect pipeline performs any additional setup or post connection steps required to establish a connection. By default, the connect pipeline will establish connections using the `DriverConnectionProvider` class. If you would like to use a non-default `ConnectionProvider` to create connections, you can do so by calling `ConnectionProviderManager.setConnectionProvider(new CustomConnectionProvider())`.

The wrapper provides a custom connection provider called `InternalPooledConnectionProvider`. This provider creates pooled clients and are intended to be used with the Read/Write Splitting plugin. To learn more about this provider, see the internal connection pool section in [UsingTheReadWriteSplittingPlugin.md](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheReadWriteSplittingPlugin.md).

The most common usage of the connect pipeline is to fetch extra credentials from external locations.

An example would be the IAM connection plugin. The IAM connection plugin generates an IAM authentication token to be used when establishing a connection. Since authentication is only required when establishing a connection and not required for any subsequent execution, the IAM authentication plugin only needs to implement the connect pipeline.

## Force Connect Pipeline

The force connect pipeline is similar to the connect pipeline except that it will use the default `DriverConnectionProvider` class to establish connections regardless of whether a non-default `ConnectionProvider` has been requested via `ConnectionProviderManager.setConnectionProvider(new CustomConnectionProvider())`. For most plugins, the connect and force connect implementation will be equivalent.

## Execute Pipeline

The execute pipeline performs additional work for method calls. This pipeline is not limited to query execution methods, it may be called for any methods such as `setTimeout` or `isValid`.

Usages for this pipeline include:

- handling errors
- logging and measuring execution information
- caching execution results

An example of the execute pipeline is the [execute time plugin](../../common/lib/plugins/execute_time_plugin.ts).
This plugin measures and logs the time required to execute a method.

A more complex example of this would be the [failover plugin](../../common/lib/plugins/failover/failover_plugin.ts).
The failover plugin performs two main tasks before and after the method call:

- updates the host lists before executing the method
- catches network errors and performs the failover procedure

## Host Provider Pipeline

The host provider pipeline sets up the [host list provider](./PluginService.md#host-list-providers) via the plugin service.
This pipeline is executed once during the initialization stage of the connection.

All subscribed plugins are called to set up their respective host list provider.
Since each connection may only have one host list provider,
setting a host list provider would override any previously set host list providers.

The host list providers are used to retrieve host information about the database server,
either from the connection string or by querying the database server.
For simple use cases where having up-to-date information on all existing database replicas is not necessary,
using a simple host list provider such as the [connection string host list provider](../../common/lib/host_list_provider/connection_string_host_list_provider.ts) would be necessary.
The connection string host list provider simply parses the host and port information from the connection string during initialization,
it does not perform any additional work.

For cases where keeping updated information on existing and available replicas is necessary,
such as during the failover procedure, it is important to have a host list provider that can re-fetch information once in a while,
like the [RDS host list provider](../../common/lib/host_list_provider/rds_host_list_provider.ts).
The RDS host list provider should be automatically used by the wrapper when the application is connecting to Aurora databases.
However, you can ensure that the provider is used by specifying a topology-aware dialect, for more information, see [Database Dialects](../using-the-nodejs-driver/DatabaseDialects.md).

## Connection Changed Notification Pipeline

Plugins can subscribe to this pipeline to perform special handling when the current connection has changed. Once
subscribed, plugins should override the `notifyConnectionChanged` method to implement any desired logic. This method
will be called whenever the current connection changes. Plugins can also provide suggestions of what to do with the old
connection by returning a
[suggested action](../../common/lib/old_connection_suggestion_action.ts).

## Host List Changed Notification Pipeline

Plugins can subscribe to this pipeline to perform special handling when the current host list of databases has changed.
Once subscribed, plugins should override the `notifyHostListChanged` method to implement any desired logic. This method
will be called whenever changes in the current host list are detected.

## Accepts Strategy Pipeline

Plugins should subscribe to this pipeline and the get HostInfo by strategy pipeline if they implement a host selection strategy via the `getHostInfoByStrategy` method. In this case, plugins should override the `acceptsStrategy` and `getHostInfoByStrategy` methods to implement any desired logic. The `acceptsStrategy` method should return true for each selection strategy that the plugin supports.

## Get HostInfo by Strategy Pipeline

Plugins should subscribe to this pipeline and the accepts strategy pipeline if they implement a host selection strategy. In this case, plugins should override both the `acceptsStrategy` method and the `getHostInfoByStrategy` method. The `getHostInfoByStrategy` method should implement the desired logic for selecting a host using any plugin-accepted strategies. Host selection via a "random" strategy is supported by default.

## Release Resources Pipeline

Plugins should implement the `CanReleaseResources` interface if they have resources to clean up when connections are closed. The method `releaseResources` will be called for every plugin that implements the interface when `Client.end()` is called.
