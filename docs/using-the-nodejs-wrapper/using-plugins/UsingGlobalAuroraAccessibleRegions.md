# Global Aurora Accessible Regions

The `gdbAccessibleRegions` parameter allows applications to restrict Global Aurora Database operations to a subset of accessible AWS regions. This is useful when network policies, compliance requirements, or latency constraints prevent an application from reaching certain geographic regions in a Global Aurora Database.

## Feature Availability

This feature is available since version 3.0.0.

## Overview

When specified, the `gdbAccessibleRegions` parameter filters out hosts from inaccessible regions across all Global Aurora Database operations:

- **Topology Monitoring** - Skips monitoring host workers for excluded regions, reducing unnecessary network calls.
- **Failover** - Filters failover candidates to only accessible regions. Fails fast with an error if the writer is in an inaccessible region rather than attempting connections that will time out.
- **Read/Write Splitting** - Rejects writer connections to inaccessible regions and filters reader hosts to only those in accessible regions.
- **Initial Connection Strategy** - Delegates region filtering to the dialect layer, ensuring initial connections only target accessible hosts.

## Configuration

| Parameter              |  Value   | Required | Description                                                                                                                                                                                                                                                                                 | Default Value |
| ---------------------- | :------: | :------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `gdbAccessibleRegions` | `string` |    No    | Comma-separated list of AWS regions that are accessible from this application. When specified, the wrapper restricts Global Aurora Database operations to the listed regions only. Regions not included in this list will be filtered out from topology information and connection targets. | `null`        |

## Usage

Set the `gdbAccessibleRegions` parameter to a comma-separated list of AWS region names that your application can reach.

```typescript
const params = {
  plugins: "initialConnection,gdbFailover,efm2",
  wrapperDialect: "global-aurora-pg",
  failoverHomeRegion: "us-west-2",
  globalClusterInstanceHostPatterns: "?.XYZ1.us-east-1.rds.amazonaws.com,?.XYZ2.us-east-2.rds.amazonaws.com,?.XYZ3.us-west-2.rds.amazonaws.com",
  gdbAccessibleRegions: "us-west-2,us-east-1"
  // Add other connection properties below...
};

// If using MySQL:
const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:
const client = new AwsPGClient(params);
await client.connect();
```

In this example, the application can only reach `us-west-2` and `us-east-1`. Any hosts in `us-east-2` will be filtered out from topology monitoring, failover candidates, and read/write splitting targets.

## Behavior

### When the writer is in an inaccessible region

If the current writer host resides in a region not listed in `gdbAccessibleRegions`, the wrapper will throw an error rather than silently retrying connections that cannot succeed. This fail-fast behavior prevents long timeouts and makes it clear to the application that the writer is currently unreachable.

### Interaction with `failoverHomeRegion`

The `gdbAccessibleRegions` parameter works alongside the `failoverHomeRegion` parameter. While `failoverHomeRegion` defines the preferred region for failover logic, `gdbAccessibleRegions` defines which regions can be reached at all. If a `failoverHomeRegion` is specified that is not in the `gdbAccessibleRegions` list, the home region will be unreachable.

> [!WARNING]
> Ensure that `failoverHomeRegion` is included in the `gdbAccessibleRegions` list. Otherwise, home region failover logic will not function correctly.

### Interaction with GlobalDb Read/Write Splitting

When using the `gdbReadWriteSplitting` plugin, accessible regions filtering is applied before reader/writer host selection. The `gdbRwHomeRegion` should also be included in the accessible regions list.

## Configuration Examples

### Example 1: Application restricted to two regions

**Scenario:** An application deployed in `us-west-2` connects to a Global Database spanning `us-east-1`, `us-east-2`, and `us-west-2`. Network policy blocks access to `us-east-2`.

```typescript
const params = {
  plugins: "initialConnection,gdbFailover,efm2",
  wrapperDialect: "global-aurora-pg",
  failoverHomeRegion: "us-west-2",
  globalClusterInstanceHostPatterns: "?.XYZ1.us-east-1.rds.amazonaws.com,?.XYZ2.us-east-2.rds.amazonaws.com,?.XYZ3.us-west-2.rds.amazonaws.com",
  gdbAccessibleRegions: "us-west-2,us-east-1",
  activeHomeFailoverMode: "strict-writer",
  inactiveHomeFailoverMode: "strict-writer"
};
```

### Example 2: Application restricted to home region only

**Scenario:** An application must only connect to instances in its own region for data sovereignty compliance.

```typescript
const params = {
  plugins: "initialConnection,gdbFailover,efm2",
  wrapperDialect: "global-aurora-mysql",
  failoverHomeRegion: "eu-west-1",
  globalClusterInstanceHostPatterns: "?.XYZ1.us-east-1.rds.amazonaws.com,?.XYZ2.eu-west-1.rds.amazonaws.com,?.XYZ3.ap-southeast-1.rds.amazonaws.com",
  gdbAccessibleRegions: "eu-west-1",
  activeHomeFailoverMode: "strict-home-reader",
  inactiveHomeFailoverMode: "strict-home-reader"
};
```

> [!NOTE]
> When restricting to a single region, be aware that if the writer fails over to another region, the application will only have access to reader hosts. Configure your failover mode accordingly (e.g., `strict-home-reader`).
