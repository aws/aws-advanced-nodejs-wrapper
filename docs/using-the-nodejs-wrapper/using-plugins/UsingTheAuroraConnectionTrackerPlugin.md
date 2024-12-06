# Aurora Connection Tracker Plugin

This plugin tracks all the opened connections. In the event of a cluster failover, this plugin will close all the impacted connections.
If no plugins are explicitly specified, this plugin is enabled by default.

## Use Case

User applications can have two types of connections:

1. active connections that are used to execute statements or perform other types of database operations.
2. idle connections that the application holds references but are not used for any operations.

For example, the user application had an active connection and an idle connection to instance A where instance A was a writer instance. The user application was executing DML statements against instance A when a cluster failover occurred. A different instance was promoted as the writer, so instance A is now a reader. The driver will failover the active connection to the new writer, but it would not modify the idle connection.

When the application tries to continue the workflow with the idle connection that is still pointing to an instance that has changed roles, i.e. instance A, users may get an error caused by unexpected behaviour, such as `Error: Cannot execute statement in a READ ONLY transaction.`.

Since the Aurora Connection Tracker Plugin keeps track of all the open connections, the plugin can close all impacted connections after failover.
When the application tries to use the outdated idle connection, the application will get an error such as `Can't add new command when connection is in closed state` instead.

> [!WARNING]
> Connections with the Aurora Connection Tracker Plugin may have cached resources used throughout multiple connections. To clean up any resources used by the plugins at the end of the application call `await PluginManager.releaseResources()`.
