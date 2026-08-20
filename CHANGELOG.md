# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/#semantic-versioning-200).

## [3.0.0] - 2026-08-20

### :boom: Breaking Changes

- Optional runtime dependencies are no longer installed for you. `@opentelemetry/api`, `http-cookie-agent` and `tough-cookie` moved from `dependencies` to optional `peerDependencies`, and the OpenTelemetry SDK packages (`@opentelemetry/context-async-hooks`, `@opentelemetry/resources`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/semantic-conventions`) are no longer declared by the wrapper at all. Applications that use telemetry, or the [Federated Authentication](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheFederatedAuthPlugin.md) and [Okta Authentication](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheOktaAuthPlugin.md) plugins, must add the packages they need to their own dependencies.
- Client constructors are typed. `AwsPgClient`, `AwsPgPoolClient`, `AwsMySQLClient` and `AwsMySQLPoolClient` now accept `AwsPgClientConfig` / `AwsMySQLClientConfig` in place of `any`, so TypeScript rejects unknown or misspelled connection properties at compile time. This is a compile-time change only; runtime behaviour is unchanged. Configurations that relied on the untyped parameter may need corrections.
- `any` has been removed from the external API. Most visibly, `query()` on the MySQL clients now resolves to `[T, FieldPacket[]]` rather than `[T, any]`. Code that consumed those results loosely may need type updates.

### :magic_wand: Added

- Support for [Amazon Aurora Global Databases](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/GlobalDatabases.md), including in-region and cross-region failover, global writer endpoint recognition and stale DNS handling.
- [Global Database Failover Plugin](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheGlobalDbFailoverPlugin.md), which adds the notion of a home region and lets failover behaviour be configured separately for the in-home and out-of-home cases.
- [Global Database Read/Write Splitting Plugin](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheGlobalDbReadWriteSplittingPlugin.md), which can constrain new connections to a home region.
- [Restricting Aurora Global Database access by region](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingGlobalAuroraAccessibleRegions.md) with the `gdbAccessibleRegions` parameter.
- [Monitoring connection priority](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingMonitoringConnectionPriority.md), which directs the topology monitor's connection to a preferred host type or region.
- Exported configuration types `AwsClientConfig`, `AwsPgClientConfig` and `AwsMySQLClientConfig`.

### :crab: Changed

- Renamed the PostgreSQL client to `AwsPgClient` and its pooled connection type to `AwsPgPooledConnection` for consistent `Pg` casing across the `pg` module. This is a non-breaking change.
- PostgreSQL dialect queries are now schema-qualified, so they resolve correctly regardless of the session `search_path`.

### :warning: Deprecated

- `AwsPGClient` and `AwsPGPooledConnection` are now deprecated. They remain exported as backwards-compatible aliases of `AwsPgClient` and `AwsPgPooledConnection` and behave identically, so existing code continues to work without modification. Update imports to the new names; the deprecated aliases are scheduled for removal in the next major release.

### :bug: Fixed

- IAM, Federated Authentication and Okta authentication now work against Aurora MySQL. Aurora asks a token-authenticated user for the `mysql_clear_password` authentication plugin, which the underlying driver refuses unless `enableCleartextPlugin` is set; the wrapper now enables it when a token-based authentication plugin is in use and the connection is encrypted. See [MySQL requires an encrypted connection](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheIamAuthenticationPlugin.md#mysql-requires-an-encrypted-connection).
- Failover is now triggered by read-only connection errors when using `strict-writer` failover mode.

## [2.1.1] - 2026-05-28

### :magic_wand: Added

- Added Aurora Initial Connection Strategy Plugin as one of default plugins enabled. To learn more about the plugin, [see the documentation here.](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheAuroraInitialConnectionStrategyPlugin.md)

### :bug: Fixed

- Prevent process crash during Aurora failover when using the PostgreSQL client, addresses [issue #620](https://github.com/aws/aws-advanced-nodejs-wrapper/issues/620) ([PR #621](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/621)).

## [2.1.0] - 2026-01-15

### :magic_wand: Added

- New connection properties for users to load custom Secrets [using the AWS Secrets Manager Authentication Plugin](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheAwsSecretsManagerPlugin.md).

### :bug: Fixed

- Aurora Initial Connection Strategy Plugin incorrectly erroring out during initial connections when using instance endpoints ([PR #601](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/601)).
- Event listeners not properly removed resulting in unnecessary warning, addresses [issue #598](https://github.com/aws/aws-advanced-nodejs-wrapper/issues/598).
- Runtime dependency configuration causing import errors in certain environments ([PR #592](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/592)).

## [2.0.1] - 2025-10-17

### :bug: Fixed

- Limitless Connection Plugin to properly round the load metric values for Limitless transaction routers ([PR #557](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/557)).

### :crab: Changed

- Update documentation for Blue/Green Support ([PR #564](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/564)).
- Add qualifiers to PostgreSQL SQL statements ([PR #574](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/574)).

## [2.0.0] - 2025-09-11

### :magic_wand: Added

- [Connection Pool](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/UsingTheConnectionPool.md).
- [Exported additional API compatible with the community drivers](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/UsingTheAwsClients.md).

## [1.3.0] - 2025-07-28

### :magic_wand: Added

- [Blue/Green deployment support](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/using-plugins/UsingTheBlueGreenPlugin.md#bluegreen-deployment-plugin).
- More extensive integration tests for existing plugins.

### :crab: Changed

- Improve the force connect pipeline ([PR #480](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/480)).

### :bug: Fixed

- Incorrect caching in the plugin chain, reducing performance overhead ([PR #464](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/464)).
- Incorrect transaction level tracked in session states ([PR #504](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/504)).

## [1.2.0] - 2025-03-12

### :magic_wand: Added

- Enhanced Failover Monitoring 2 Plugin. See [Using The Host Monitoring Plugin](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheHostMonitoringPlugin.md#host-monitoring-plugin-v2).
- Custom Endpoint Plugin. See [Using the Custom Endpoint Plugin](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheCustomEndpointPlugin.md).
- Failover 2 Plugin. See [Using the Failover 2 Plugin](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheFailover2Plugin.md).
- Documentation on [session state](./docs/using-the-nodejs-wrapper/SessionState.md), [driver dialects](./docs/using-the-nodejs-wrapper/DriverDialects.md), [fastest response strategy](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheFastestResponseStrategyPlugin.md), and [maintenance](./MAINTENANCE.md).

### :crab: Changed

- More robust MySQL catalog usage detection ([PR #366](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/366)).
- Changed connection tracker to update after reader failover to new connection ([PR #356](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/356)).
- Improved documentation instructions for integration tests and running code samples ([PR #370](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/370) & [PR #374](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/374)).

### :bug: Fixed

- Usage of setQueryTimeout for MySQL2DriverDialect ([PR #393](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/393)).
- Retrieving keep alive settings ([PR #395](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/395)).
- Reader failover to wait for complete batch ([PR #390](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/390)).
- EFM2 abort and stop monitoring on dead connection ([PR #415](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/415)).
- Check if first connection after failover is stale ([PR #416](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/416)).

## [1.1.0] - 2024-12-12

### :magic_wand: Added

- [Configuration Profiles](./docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#configuration-profiles) provide an alternative way of loading plugins and providing configuration parameters ([PR #338](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/338)).
- New network related [configuration parameters](./docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#aws-advanced-nodejs-wrapper-parameters):
  - setKeepAlive method ([PR #339](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/339))
  - set connect and query timeouts ([PR #342](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/342))
- Fastest Response Strategy Plugin selects reader based on fastest response time ([PR #345](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/345)).
- Simple connection tutorial using Prisma ORM. See [Using The NodeJS Wrapper with Prisma ORM](./examples/prisma_example/README.md).
- Added configuration parameter connectionProvider ([PR #330](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/330)).
  - This replaces the setConnectionProvider method. For an example, see: [Using Internal Connection Pooling](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheReadWriteSplittingPlugin.md/#internal-connection-pooling).

### :crab: Changed

- Deprecated configuration parameter [mysqlQueryTimeout](./docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#aws-advanced-nodejs-wrapper-parameters).
- Updated documentation on host patterns, custom endpoints, and prerequisites for the Okta and ADFS Plugins ([PR #319](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/319) & [PR #327](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/327)).
- Migrated to AWS JS SDK v3 ([PR #331](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/331)).
- Optimized getHostInfoByStrategy and acceptsStrategy calls for the Plugin Manager ([PR #332](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/332)).
- Updated AwsClient#releaseResources to be a static method called at the end of an application ([PR #333](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/333) & [PR #347](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/347)).
- Updated Session State logging to display false values ([PR #337](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/337)).

## [1.0.0] - 2024-11-19

The Amazon Web Services (AWS) Advanced NodeJS Wrapper allows an application to take advantage of the features of clustered Aurora databases.

[2.1.1]: https://github.com/aws/aws-advanced-nodejs-wrapper/compare/2.1.0...2.1.1
[2.1.0]: https://github.com/aws/aws-advanced-nodejs-wrapper/compare/2.0.1...2.1.0
[2.0.1]: https://github.com/aws/aws-advanced-nodejs-wrapper/compare/2.0.0...2.0.1
[2.0.0]: https://github.com/aws/aws-advanced-nodejs-wrapper/compare/1.3.0...2.0.0
[1.3.0]: https://github.com/aws/aws-advanced-nodejs-wrapper/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/aws/aws-advanced-nodejs-wrapper/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/aws/aws-advanced-nodejs-wrapper/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/aws/aws-advanced-nodejs-wrapper/releases/tag/1.0.0
