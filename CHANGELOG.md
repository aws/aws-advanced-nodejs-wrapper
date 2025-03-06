# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/#semantic-versioning-200).

## [1.2.0] - 2025-03-06

### :magic_wand: Added

- ([Enhanced Failover Monitoring 2 Plugin](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheHostMonitoringPlugin.md#host-monitoring-plugin-v2)).
- ([Custom Endpoint Plugin](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheCustomEndpointPlugin.md)).
- ([Failover 2 Plugin](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheFailover2Plugin.md).
- Documentation on ([session state](./docs/using-the-nodejs-wrapper/SessionState.md)), ([driver dialects](./docs/using-the-nodejs-wrapper/DriverDialects.md)), ([fastest response strategy](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheFastestResponseStrategyPlugin.md)), and ([maintenance](./MAINTENANCE.md)).

### :crab: Changed

- More robust MySQL catalog usage detection ([PR #366](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/366)).
- Changed connection tracker to update after reader failover to new connection ([PR #356](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/356)).
- Improved documentation instructions for integration tests and running code samples ([PR #370](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/370)) & ([PR #374](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/374)).

### :bug: Fixed

- setQueryTimeout for MySQL2DriverDialect ([PR #393](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/393)).
- Retrieving keep alive settings ([PR #395](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/395)).
- Reader failover wait for complete batch ([PR #390](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/390)).

## [1.1.0] - 2024-12-12

### :magic_wand: Added

- [Configuration Profiles](./docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#configuration-profiles) provide an alternative way of loading plugins and providing configuration parameters ([PR #338](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/338)).
- New network related [configuration parameters](./docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#aws-advanced-nodejs-wrapper-parameters):
  - setKeepAlive method ([PR #339](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/339))
  - set connect and query timeouts ([PR #342](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/342))
- Fastest Response Strategy Plugin selects reader based on fastest response time ([PR #345](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/345)).
- Simple connection tutorial using Prisma ORM. See [Using The NodeJS Wrapper with Prisma ORM](./examples/prisma_example/README.md).
- Added configuration parameter connectionProvider ([PR #330](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/330)).
  - This replaces the setConnectionProvider method. For an example, see: [Using Internal Connection Pooling](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheReadWriteSplittingPlugin.md/#internal-connection-pooling)

### :crab: Changed

- Deprecated configuration parameter [mysqlQueryTimeout](./docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#aws-advanced-nodejs-wrapper-parameters).
- Updated documentation on host patterns, custom endpoints, and prerequisites for the Okta and ADFS Plugins ([PR #319](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/319)) & ([PR #327](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/327)).
- Migrated to AWS JS SDK v3 ([PR #331](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/331)).
- Optimized getHostInfoByStrategy and acceptsStrategy calls for the Plugin Manager ([PR #332](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/332)).
- Updated AwsClient#releaseResources to be a static method called at the end of an application ([PR #333](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/333)) & [PR #347](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/347)).
- Updated Session State logging to display false values ([PR #337](https://github.com/aws/aws-advanced-nodejs-wrapper/pull/337)).

## [1.0.0] - 2024-11-19

The Amazon Web Services (AWS) Advanced NodeJS Wrapper allows an application to take advantage of the features of clustered Aurora databases.

[0.0.1]: https://github.com/awslabs/aws-advanced-nodejs-wrapper/releases/tag/0.0.1
