# Enhanced Support for Amazon RDS Multi-AZ DB Cluster

The AWS Advanced NodeJS Wrapper has support for Amazon RDS Multi-AZ DB Cluster Deployments. By leveraging the topology information within the RDS Multi-AZ DB Cluster, the wrapper is capable of switching over the connection to a new writer host in approximately 1 second or less, given there is no replica lag during minor version upgrades or OS maintenance upgrades.

## General Usage

The process of using the AWS Advanced NodeJS Wrapper with RDS Multi-AZ DB Clusters is the same as using it with an RDS Aurora cluster. All properties, configurations, functions, etc., remain consistent. Instead of connecting to a generic database endpoint, replace the endpoint with the Cluster Writer Endpoint provided by the RDS Multi-AZ DB Cluster.

### MySQL

To prepare a connection with MySQL in a Multi-AZ Cluster, please refer to [this example](../../examples/aws_driver_example/aws_simple_connection_mysql_example.ts).

### PostgreSQL

The topology information is populated in Amazon RDS for PostgreSQL versions 13.12, 14.9, 15.4, or higher, starting from revision R3. Ensure you have a supported PostgreSQL version deployed.

Per AWS documentation, the `rds_tools` extension must be manually installed using the following DDL before the topology information becomes available on target cluster:

```sql
CREATE EXTENSION rds_tools;
```

To prepare a connection with PostgreSQL in a Multi-AZ Cluster, please refer to [this example](../../examples/aws_driver_example/aws_simple_connection_postgresql_example.ts).

## Optimizing Switchover Time

Amazon RDS Multi-AZ with two readable standbys supports minor version upgrades with 1 second of downtime.

See feature announcement [here](https://aws.amazon.com/about-aws/whats-new/2023/11/amazon-rds-multi-az-two-stanbys-upgrades-downtime/).

During minor version upgrades of RDS Multi-AZ DB clusters, the `failover` plugin switches the connection from the current writer to a newly upgraded reader. If minimizing downtime during switchover is critical to your application, consider adjusting the `failoverClusterTopologyRefreshRateMs` to a lower value such as 100ms, from the default 2000ms. However, be aware that this can potentially increase the workload on the database during the switchover.

For more details on the `failover` plugin configuration, refer to the [Failover Configuration Guide](/docs/using-the-nodejs-wrapper/FailoverConfigurationGuide.md).

## Limitations

The following plugins have been tested and confirmed to work with Amazon RDS Multi-AZ DB Clusters:

- [Aurora Connection Tracker Plugin](/docs/using-the-nodejs-wrapper/using-plugins/UsingTheAuroraConnectionTrackerPlugin.md)
- [Failover Connection Plugin](/docs/using-the-nodejs-wrapper/using-plugins/UsingTheFailoverPlugin.md)
- [Host Monitoring Connection Plugin](/docs/using-the-nodejs-wrapper/using-plugins/UsingTheHostMonitoringPlugin.md)

The compatibility of other plugins has not been tested at this time. They may function as expected or potentially result in unhandled behavior.
Use at your own discretion.
