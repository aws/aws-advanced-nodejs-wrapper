# Using the AWS Advanced NodeJS Wrapper

The AWS Advanced NodeJS Wrapper leverages community database clients and enables support of AWS and Aurora functionalities. Currently, the [node-postgres client](https://github.com/brianc/node-postgres) and [Node MySQL2 clients](https://github.com/sidorares/node-mysql2) are supported.

## Using the AWS Advanced NodeJS Wrapper with plain RDS databases

It is possible to use the AWS Advanced NodeJS Wrapper with plain RDS databases, but individual features may or may not be compatible. For example, failover handling and enhanced failure monitoring are not compatible with plain RDS databases and the relevant plugins must be disabled. Plugins can be enabled or disabled as seen in the [Connection Plugin Manager Parameters](#connection-plugin-manager-parameters) section. Please note that some plugins have been enabled by default. Plugin compatibility can be verified in the [plugins table](#list-of-available-plugins).

## Getting a Connection

To get a connection from the AWS Advanced NodeJS Wrapper, the user application can create a client object and connect. Additional parameters can be specified within the client configuration. Configuration parameters defined by the supported clients can also be set here. For example, to connect to a MySQL database, an AwsMySQLClient is required:

```typescript
const client = new AwsMySQLClient({
  user: "user",
  password: "password",
  host: "host",
  database: "database"
});
await client.connect();
```

To connect to a PostgreSQL database an AwsPgClient is required:

```typescript
const client = new AwsPgClient({
  user: "user",
  password: "password",
  host: "host",
  database: "database"
});
await client.connect();
```

## Logging

To enable logging when using the AWS Advanced NodeJS Wrapper, use the `LOG_LEVEL` environment variable. The log level can be set to one of the following values: `silent`, `error`, `warn`, `notice`, `http`, `timing`, `info`, `verbose`, or `silly`.

## AWS Advanced NodeJS Wrapper Parameters

These parameters are applicable to any instance of the AWS Advanced NodeJS Wrapper.

| Parameter                      | Value     | Required | Description                                                                                                                                                                                                                                                                                                                                          | Default Value |
| ------------------------------ | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `host`                         | `String`  | No       | Database host.                                                                                                                                                                                                                                                                                                                                       | `null`        |
| `database`                     | `String`  | No       | Database name.                                                                                                                                                                                                                                                                                                                                       | `null`        |
| `user`                         | `String`  | No       | Database username.                                                                                                                                                                                                                                                                                                                                   | `null`        |
| `password`                     | `String`  | No       | Database password.                                                                                                                                                                                                                                                                                                                                   | `null`        |
| `transferSessionStateOnSwitch` | `boolean` | No       | Enables transferring the session state to a new connection.                                                                                                                                                                                                                                                                                          | `true`        |
| `resetSessionStateOnClose`     | `boolean` | No       | Enables resetting the session state before closing connection.                                                                                                                                                                                                                                                                                       | `true`        |
| `enableGreenNodeReplacement`   | `boolean` | No       | Enables replacing a green node host name with the original host name when the green host DNS doesn't exist anymore after a blue/green switchover. Refer to [Overview of Amazon RDS Blue/Green Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-overview.html) for more details about green and blue nodes. | `false`       |

## Plugins

The AWS Advanced NodeJS Wrapper uses plugins to execute methods. You can think of a plugin as an extensible code module that adds extra logic around any database method calls. The AWS Advanced NodeJS Wrapper has a number of [built-in plugins](#list-of-available-plugins) available for use.

Plugins are loaded and managed through the Connection Plugin Manager and may be identified by a `String` name in the form of plugin code.

### Connection Plugin Manager Parameters

| Parameter                    | Value     | Required | Description                                                                                                                                                     | Default Value                          |
| ---------------------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `plugins`                    | `String`  | No       | Comma separated list of connection plugin codes. <br><br>Example: `failover,efm`                                                                                | `auroraConnectionTracker,failover,efm` |
| `autoSortWrapperPluginOrder` | `Boolean` | No       | Allows the AWS Advanced NodeJS Wrapper to sort connection plugins to prevent plugin misconfiguration. Allows a user to provide a custom plugin order if needed. | `true`                                 |

To use a built-in plugin, specify its relevant plugin code for the `plugins` .
The default value for `plugins` is `failover`. These plugins are enabled by default. To read more about these plugins, see the [List of Available Plugins](#list-of-available-plugins) section.
To override the default plugins, simply provide a new value for `plugins`.
For instance, to use the [IAM Authentication Connection Plugin](./using-plugins/UsingTheIamAuthenticationPlugin.md) and the [Failover Connection Plugin](./using-plugins/UsingTheFailoverPlugin.md):

```typescript
const client = new AwsMySQLClient({
  user: "user",
  password: "password",
  host: "host",
  database: "database",
  plugins: "iam,failover"
});
```

> :exclamation:**NOTE**: The plugins will be initialized and executed in the order they have been specified.

Provide an empty string to disable all plugins:

```typescript
const client = new AwsMySQLClient({
  user: "user",
  password: "password",
  host: "host",
  database: "database",
  plugins: ""
});
```

The Wrapper behaves like the target driver when no plugins are used.

### List of Available Plugins

The AWS Advanced NodeJS Wrapper has several built-in plugins that are available to use. Please visit the individual plugin page for more details.

| Plugin name                                                                                 | Plugin Code          | Database Compatibility          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Additional Required Dependencies                                                                 |
| ------------------------------------------------------------------------------------------- | -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Failover Connection Plugin](./using-plugins/UsingTheFailoverPlugin.md)                     | `failover`           | Aurora, RDS Multi-AZ DB Cluster | Enables the failover functionality supported by Amazon Aurora clusters and RDS Multi-AZ DB clusters. Prevents opening a wrong connection to an old writer node dues to stale DNS after failover event. This plugin is enabled by default.                                                                                                                                                                                                                                                                              | None                                                                                             |
| Execution Time Connection Plugin                                                            | `executionTime`      | Any database                    | Logs the time taken to execute any client method.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | None                                                                                             |
| [IAM Authentication Connection Plugin](./using-plugins/UsingTheIamAuthenticationPlugin.md)  | `iam`                | Aurora                          | Enables users to connect to their Amazon Aurora clusters using AWS Identity and Access Management (IAM).                                                                                                                                                                                                                                                                                                                                                                                                               | [@aws-sdk/rds-signer](https://www.npmjs.com/package/@aws-sdk/rds-signer)                         |
| [AWS Secrets Manager Connection Plugin](./using-plugins/UsingTheAwsSecretsManagerPlugin.md) | `secretsManager`     | Any database                    | Enables fetching database credentials from the AWS Secrets Manager service.                                                                                                                                                                                                                                                                                                                                                                                                                                            | [@aws-sdk/client-secrets-manager](https://www.npmjs.com/package/@aws-sdk/client-secrets-manager) |
| [Federated Authentication Plugin](./using-plugins/UsingTheFederatedAuthPlugin.md)           | `federatedAuth`      | Aurora                          | Enables users to authenticate using Federated Identity and then connect to their Amazon Aurora Cluster using AWS Identity and Access Management (IAM).                                                                                                                                                                                                                                                                                                                                                                 |                                                                                                  |
| [Okta Authentication Plugin](./using-plugins/UsingTheOktaAuthPlugin.md)                     | `okta`               | Aurora                          | Enables users to authenticate using Federated Identity and then connect to their Amazon Aurora Cluster using AWS Identity and Access Management (IAM).                                                                                                                                                                                                                                                                                                                                                                 |                                                                                                  |
| Aurora Stale DNS Plugin                                                                     | `staleDns`           | Aurora                          | Prevents incorrectly opening a new connection to an old writer node when DNS records have not yet updated after a recent failover event. <br><br> :warning:**Note:** Contrary to `failover` plugin, `auroraStaleDns` plugin doesn't implement failover support itself. It helps to eliminate opening wrong connections to an old writer node after cluster failover is completed. <br><br> :warning:**Note:** This logic is already included in `failover` plugin so you can omit using both plugins at the same time. | None                                                                                             |
| [Read Write Splitting Plugin](./using-plugins/UsingTheReadWriteSplittingPlugin.md)          | `readWriteSplitting` | Aurora                          | Enables read write splitting functionality where users can switch between database reader and writer instances.                                                                                                                                                                                                                                                                                                                                                                                                        | None                                                                                             |

In addition to the built-in plugins, you can also create custom plugins more suitable for your needs.
For more information, see [Custom Plugins](../development-guide/LoadablePlugins.md#using-custom-plugins).
