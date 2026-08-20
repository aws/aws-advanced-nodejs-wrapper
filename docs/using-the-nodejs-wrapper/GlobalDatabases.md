# Aurora Global Databases

> **Since version:** 3.0.0

The AWS Advanced NodeJS Wrapper provides comprehensive support for [Amazon Aurora Global Databases](https://aws.amazon.com/rds/aurora/global-database/), including both in-region and cross-region failover capabilities.

## Overview

Aurora Global Database is a feature that allows a single Aurora database to span multiple AWS regions. It provides fast replication across regions with minimal impact on database performance, enabling disaster recovery and serving read traffic from multiple regions.

The AWS Advanced NodeJS Wrapper supports:

- In-region failover
- Cross-region planned failover and switchover
- Global writer endpoint recognition
- Stale DNS handling

## Configuration

The following settings are recommended by AWS Service Teams for Aurora Global Database connections. This configuration provides writer connections with support for both in-region and cross-region failover.

### Writer Connections

**Endpoint:**
Use the global cluster endpoint:

```
<global-db-name>.global-<XYZ>.global.rds.amazonaws.com
```

**Configuration Parameters:**

| Parameter                           | Value                                                                                                                         | Notes                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `clusterId`                         | `1`                                                                                                                           | See [clusterId parameter documentation](./ClusterId.md)         |
| `wrapperDialect`                    | `global-aurora-mysql` or `global-aurora-pg`                                                                                   |                                                                 |
| `plugins`                           | `initialConnection,failover2,efm2` or<br>`initialConnection,gdbFailover,efm2`                                                 | Without connection pooling                                      |
|                                     | `auroraConnectionTracker,initialConnection,failover2,efm2` or<br>`auroraConnectionTracker,initialConnection,gdbFailover,efm2` | With connection pooling                                         |
| `globalClusterInstanceHostPatterns` | `?.XYZ1.us-east-2.rds.amazonaws.com,?.XYZ2.us-west-2.rds.amazonaws.com`                                                       | See [documentation](./using-plugins/UsingTheFailover2Plugin.md) |

> **Note:** Add additional plugins according to the [compatibility guide](./compatibility/CompatibilityCrossPlugins.md).

### Reader Connections

**Endpoint:**
Use the cluster reader endpoint:

```
<cluster-name>.cluster-ro-<XYZ>.<region>.rds.amazonaws.com
```

**Configuration Parameters:**

| Parameter                           | Value                                                                                                                         | Notes                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `clusterId`                         | `1`                                                                                                                           | Use the same value as writer connections |
| `wrapperDialect`                    | `global-aurora-mysql` or `global-aurora-pg`                                                                                   |                                          |
| `plugins`                           | `initialConnection,failover2,efm2` or<br>`initialConnection,gdbFailover,efm2`                                                 | Without connection pooling               |
|                                     | `auroraConnectionTracker,initialConnection,failover2,efm2` or<br>`auroraConnectionTracker,initialConnection,gdbFailover,efm2` | With connection pooling                  |
| `globalClusterInstanceHostPatterns` | Same as writer configuration                                                                                                  |                                          |
| `failoverMode`                      | `strict-reader` or `reader-or-writer`                                                                                         | Depending on system requirements         |

> **Note:** Add additional plugins according to the [compatibility guide](./compatibility/CompatibilityCrossPlugins.md).

## Example Configuration

```typescript
// Writer connection
const writerParams = {
  host: "my-global-db.global-xyz.global.rds.amazonaws.com",
  port: 3306,
  database: "mydb",
  user: "username",
  password: "password",
  clusterId: "1",
  wrapperDialect: "global-aurora-mysql",
  plugins: "initialConnection,failover2,efm2",
  globalClusterInstanceHostPatterns: "?.abc123.us-east-1.rds.amazonaws.com,?.def456.us-west-2.rds.amazonaws.com"
};

const writerClient = new AwsMySQLClient(writerParams);
await writerClient.connect();

// Reader connection
const readerParams = {
  host: "my-cluster.cluster-ro-xyz.us-east-1.rds.amazonaws.com",
  port: 3306,
  database: "mydb",
  user: "username",
  password: "password",
  clusterId: "1",
  wrapperDialect: "global-aurora-mysql",
  plugins: "initialConnection,failover2,efm2",
  globalClusterInstanceHostPatterns: "?.abc123.us-east-1.rds.amazonaws.com,?.def456.us-west-2.rds.amazonaws.com",
  failoverMode: "strict-reader"
};

const readerClient = new AwsMySQLClient(readerParams);
await readerClient.connect();
```

> For PostgreSQL, use `new AwsPgClient(params)` with `wrapperDialect: "global-aurora-pg"` and port `5432`.

## Important Considerations

### Database instance names

> [!WARNING]
> The plugin does not support duplicate instance names across regions. Ensure that all instance names are unique across all Global Database regions.

### Plugin Selection

- **Connection Pooling**: Include the `auroraConnectionTracker` plugin when using connection pooling.
- The `gdbFailover` plugin has extended failover functionality and supports an application home region.

### Global Cluster Instance Host Patterns

The `globalClusterInstanceHostPatterns` parameter is **required** for Aurora Global Databases. The patterns are based on
instance endpoints. It should contain:

- A comma-separated list of host patterns for each region
- Different cluster identifiers for each region (e.g., `XYZ1`, `XYZ2`)
- Proper region specification for custom domains: `[us-east-1]?.custom.com`

### Failover Behavior

- **In-region failover**: Automatic failover within the same region.
- **Cross-region failover**: Planned failover to a different region.
- **DNS handling**: The `initialConnection` plugin helps mitigate stale DNS issues.

### Restricting Access to Specific Regions

If your application can only reach a subset of the regions a Global Database spans (due to network reachability, compliance, or latency constraints), use the `gdbAccessibleRegions` property to restrict the wrapper to those regions. See [Restricting Aurora Global Database Access by Region](./using-plugins/UsingGlobalAuroraAccessibleRegions.md) for details.

### Monitoring Connection Priority

The topology monitor's background connection can be directed to a preferred host type or region using `gdbMonitoringConnectionPriority`. See [Monitoring Connection Priority](./using-plugins/UsingMonitoringConnectionPriority.md) for details.

## Compatibility

For detailed compatibility information, see:

- [Database Types Compatibility](./compatibility/CompatibilityDatabaseTypes.md)
- [Endpoint Types Compatibility](./compatibility/CompatibilityEndpoints.md)
- [Cross-Plugin Compatibility](./compatibility/CompatibilityCrossPlugins.md)

## Related Documentation

- [Global Database Failover Plugin](./using-plugins/UsingTheGlobalDbFailoverPlugin.md)
- [Global Database Read/Write Splitting Plugin](./using-plugins/UsingTheGlobalDbReadWriteSplittingPlugin.md)
- [Failover Plugin v2](./using-plugins/UsingTheFailover2Plugin.md)
- [Aurora Initial Connection Strategy Plugin](./using-plugins/UsingTheAuroraInitialConnectionStrategyPlugin.md)
- [Restricting Aurora Global Database Access by Region](./using-plugins/UsingGlobalAuroraAccessibleRegions.md)
- [Monitoring Connection Priority](./using-plugins/UsingMonitoringConnectionPriority.md)
- [IAM Authentication Plugin](./using-plugins/UsingTheIamAuthenticationPlugin.md)
- [Database Dialects](./DatabaseDialects.md)
