# Plugins compatibility

The AWS Advanced NodeJS Wrapper uses plugins to execute client methods. You can think of a plugin as an extensible code module that adds additional logic around target driver method calls. Plugins are designed with the intention of being compatible with each other; however, there are logical constraints related to database type or database features that can make plugins inefficient in certain configurations.

For example, RDS Single-AZ Instance deployments do not support failover, so the `failover` and `failover2` plugins are marked as incompatible. If either of these plugins is included in the wrapper configuration, there will be no added value. However, these unnecessary plugins will function without errors and will simply consume additional resources.

The following matrices help verify plugin compatibility with other plugins and with various database types. Some plugins are sensitive to the database URL provided in the connection configuration, and this is also presented below.

We encourage users to verify their configurations and ensure that their configuration contains no incompatible components.

- [Database type compatibility](./CompatibilityDatabaseTypes.md)
- [Database URL type compatibility](./CompatibilityEndpoints.md)
- [Cross Plugins compatibility](./CompatibilityCrossPlugins.md)

## Universally Compatible Plugins

The following plugins operate independently of connection management and are compatible with all plugins, database types, and endpoint types:

| Plugin                                                        | Description                                              |
|---------------------------------------------------------------|----------------------------------------------------------|
| [dev](../using-plugins/UsingTheDeveloperPlugin.md)             | Developer utility plugin for debugging and diagnostics.  |
| executeTime                                                   | Logs the time taken to execute any client method.        |
