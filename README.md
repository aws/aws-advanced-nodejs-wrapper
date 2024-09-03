# Amazon Web Services (AWS) Advanced NodeJS Wrapper

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

The wrapper is complementary to an existing NodeJS driver and aims to extend the functionality of the driver to enable applications to take full advantage of the features of clustered databases such as Amazon Aurora. In other words, the AWS Advanced NodeJS Wrapper does not connect directly to any database, but enables support of AWS and Aurora functionalities on top of an underlying NodeJS driver of the user's choice.

## About the Wrapper

Hosting a database cluster in the cloud via Aurora is able to provide users with sets of features and configurations to obtain maximum performance and availability, such as database failover. However, at the moment, most existing drivers do not currently support those functionalities or are not able to entirely take advantage of it.

The main idea behind the AWS Advanced NodeJS Wrapper is to add a software layer on top of an existing NodeJS driver that would enable all the enhancements brought by Aurora, without requiring users to change their workflow with their databases and existing NodeJS drivers.

### What is Failover?

In an Amazon Aurora database cluster, **failover** is a mechanism by which Aurora automatically repairs the cluster status when a primary DB instance becomes unavailable. It achieves this goal by electing an Aurora Replica to become the new primary DB instance, so that the DB cluster can provide maximum availability to a primary read-write DB instance. The AWS Advanced NodeJS Wrapper is designed to understand the situation and coordinate with the cluster in order to provide minimal downtime and allow connections to be very quickly restored in the event of a DB instance failure.

### Benefits of the AWS Advanced NodeJS Wrapper

Although Aurora is able to provide maximum availability through the use of failover, existing client drivers do not currently support this functionality. This is partially due to the time required for the DNS of the new primary DB instance to be fully resolved in order to properly direct the connection. The AWS Advanced NodeJS Wrapper allows customers to continue using their existing community drivers in addition to having the AWS Advanced NodeJS Wrapper fully exploit failover behavior by maintaining a cache of the Aurora cluster topology and each DB instance's role (Aurora Replica or primary DB instance). This topology is provided via a direct query to the Aurora DB, essentially providing a shortcut to bypass the delays caused by DNS resolution. With this knowledge, the AWS Advanced NodeJS Wrapper can more closely monitor the Aurora DB cluster status so that a connection to the new primary DB instance can be established as fast as possible.

### Enhanced Failure Monitoring

Since a database failover is usually identified by reaching a network or a connection timeout, the AWS Advanced NodeJS Wrapper introduces an enhanced and customizable manner to faster identify a database outage.

Enhanced Failure Monitoring (EFM) is a feature available from the [Host Monitoring Connection Plugin](./docs/using-the-nodejs-wrapper/using-plugins/UsingTheHostMonitoringPlugin.md#enhanced-failure-monitoring) that periodically checks the connected database instance's health and availability. If a database node is determined to be unhealthy, the connection is aborted (and potentially routed to another healthy node in the cluster).

### Using the AWS Advanced NodeJS Wrapper with RDS Multi-AZ DB Clusters

The [AWS RDS Multi-AZ DB Clusters](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html) are capable of switching over the current writer node to another node in the cluster within approximately 1 second or less, in case of minor engine version upgrade or OS maintenance operations.
The AWS Advanced NodeJS Wrapper has been optimized for such fast failover when working with AWS RDS Multi-AZ DB Clusters.

With the `failover` plugin, the downtime during certain DB cluster operations, such as engine minor version upgrades, can be reduced to one second or even less with finely tuned parameters. It supports both MySQL and PostgreSQL clusters.

Visit [this page](./docs/using-the-nodejs-wrapper/SupportForRDSMultiAzDBCluster.md) for more details.

### Using the AWS Advanced NodeJS Wrapper with plain RDS databases

The AWS Advanced NodeJS Wrapper also works with RDS provided databases that are not Aurora.

Please visit [this page](./docs/using-the-nodejs-wrapper/UsingTheNodeJSWrapper.md#using-the-aws-advanced-nodejs-wrapper-with-plain-rds-databases) for more information.

## Getting Started

For more information on how to download the AWS Advanced NodeJS Wrapper, minimum requirements to use it,
and how to integrate it within your project and with your NodeJS driver of choice, please visit the
[Getting Started page](./docs/GettingStarted.md).

## Documentation

Technical documentation regarding the functionality of the AWS Advanced NodeJS Wrapper will be maintained in this GitHub repository. Since the AWS Advanced NodeJS Wrapper requires an underlying NodeJS driver, please refer to the individual driver's documentation for driver-specific information.

### Using the AWS Advanced NodeJS Wrapper

To find all the documentation and concrete examples on how to use the AWS Advanced NodeJS Wrapper, please refer to the [AWS Advanced NodeJS Wrapper Documentation](./docs/Documentation.md) page.

## Getting Help and Opening Issues

If you encounter a bug with the AWS Advanced NodeJS Wrapper, we would like to hear about it.
Please search the [existing issues](https://github.com/awslabs/aws-advanced-nodejs-wrapper/issues) to see if others are also experiencing the issue before reporting the problem in a new issue. GitHub issues are intended for bug reports and feature requests.

When opening a new issue, please fill in all required fields in the issue template to help expedite the investigation process.

For all other questions, please use [GitHub discussions](https://github.com/awslabs/aws-advanced-nodejs-wrapper/discussions).

## How to Contribute

1. Set up your environment by following the directions in the [Development Guide](./docs/development-guide/DevelopmentGuide.md).
2. To contribute, first make a fork of this project.
3. Make any changes on your fork. Make sure you are aware of the requirements for the project.
4. Create a pull request from your fork.
5. Pull requests need to be approved and merged by maintainers into the main branch. <br />
   **Note:** Before making a pull request, [run all tests](./docs/development-guide/DevelopmentGuide.md#running-the-tests) and verify everything is passing.

## Releases

The `aws-advanced-nodejs-wrapper` has a regular monthly release cadence. A new release will occur during the last week of each month. However, if there are no changes since the latest release, then a release will not occur.

## License

This software is released under the Apache 2.0 license.
