# Monitoring Connection Priority

The monitoring connection priority parameters allow you to control which type of node the topology monitor connects to for monitoring purposes. This is useful for optimizing monitoring connections in both standard Aurora clusters and Global Aurora Databases.

## Feature Availability

This feature is available since version 3.0.0.

## Overview

By default, the topology monitor connects to a writer node to observe cluster topology changes. However, in some scenarios it may be preferable to direct monitoring connections to a reader node or to a node in a specific region.

Two parameters are available:

- **`monitoringConnectionPriority`** - For standard Aurora clusters. Controls the node type used for monitoring connections.
- **`gdbMonitoringConnectionPriority`** - For Global Aurora Databases. Extends the standard parameter with region-aware options.

## Configuration Parameters

| Parameter                         |  Value   | Required | Description                                                                                                                                                                                                                                        | Default Value   |
| --------------------------------- | :------: | :------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `monitoringConnectionPriority`    | `String` |    No    | Defines the priority for monitoring connections. Determines which type of host the topology monitor should connect to.<br><br>Possible values: `strict-writer`, `strict-reader`, `writer-or-reader`.                                               | `strict-writer` |
| `gdbMonitoringConnectionPriority` | `String` |    No    | Defines the priority for monitoring connections in a Global Aurora Database context. Supports region-aware variants and specific region names.<br><br>See [GDB Monitoring Connection Priority Values](#gdb-monitoring-connection-priority-values). | `null`          |

## Monitoring Connection Priority Values

### Standard Values (`monitoringConnectionPriority`)

| Value              | Description                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `strict-writer`    | The topology monitor connects exclusively to a writer host. If a writer is unavailable, monitoring will fail. |
| `strict-reader`    | The topology monitor connects exclusively to a reader host. If no reader is available, monitoring will fail.  |
| `writer-or-reader` | The topology monitor connects to a writer host if available; otherwise falls back to a reader host.           |

### GDB Values (`gdbMonitoringConnectionPriority`)

| Value                        | Description                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strict-writer-primary`      | Connect to the writer host in the primary region of the Global Database.                                                                          |
| `strict-writer-secondary`    | Connect to a writer host in a secondary (non-primary) region of the Global Database.                                                              |
| `strict-reader-primary`      | Connect to a reader host in the primary region of the Global Database.                                                                            |
| `strict-reader-secondary`    | Connect to a reader host in a secondary (non-primary) region of the Global Database.                                                              |
| `writer-or-reader-primary`   | Connect to a writer in the primary region if available; otherwise fall back to a reader in the primary region.                                    |
| `writer-or-reader-secondary` | Connect to a writer in a secondary region if available; otherwise fall back to a reader in a secondary region.                                    |
| `<region-name>`              | Connect to any available host in the specified AWS region (e.g., `us-west-2`). The monitor will attempt writer first, then reader in that region. |

## Usage

### Standard Aurora Cluster

```typescript
const params = {
  plugins: "failover2,efm2",
  monitoringConnectionPriority: "writer-or-reader"
  // Add other connection properties below...
};

// If using MySQL:
const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:
const client = new AwsPGClient(params);
await client.connect();
```

### Global Aurora Database

```typescript
const params = {
  plugins: "initialConnection,gdbFailover,efm2",
  wrapperDialect: "global-aurora-pg",
  failoverHomeRegion: "us-west-2",
  globalClusterInstanceHostPatterns: "?.XYZ1.us-east-1.rds.amazonaws.com,?.XYZ2.us-west-2.rds.amazonaws.com",
  gdbMonitoringConnectionPriority: "strict-writer-primary"
  // Add other connection properties below...
};

// If using MySQL:
const client = new AwsMySQLClient(params);
await client.connect();

// If using Postgres:
const client = new AwsPGClient(params);
await client.connect();
```

### Using a specific region for monitoring

```typescript
const params = {
  plugins: "initialConnection,gdbFailover,efm2",
  wrapperDialect: "global-aurora-pg",
  failoverHomeRegion: "us-west-2",
  globalClusterInstanceHostPatterns: "?.XYZ1.us-east-1.rds.amazonaws.com,?.XYZ2.us-west-2.rds.amazonaws.com",
  gdbMonitoringConnectionPriority: "us-west-2"
  // Add other connection properties below...
};
```

## Interaction with Accessible Regions

When `gdbAccessibleRegions` is configured, the monitoring connection priority respects the accessible regions filter. If the preferred monitoring target is in an inaccessible region, the monitor will fall back to an available host in an accessible region.

> [!WARNING]
> If `gdbMonitoringConnectionPriority` specifies a region that is not in the `gdbAccessibleRegions` list, the monitoring connection may fail. Ensure consistency between these parameters.

## Async Upgrade Semantics

The topology monitor may start with a connection to an available host and asynchronously upgrade to a higher-priority host when one becomes available. For example, if `strict-writer-primary` is configured but the primary writer is temporarily unavailable, the monitor may temporarily connect to another host and upgrade once the primary writer is reachable.

## Tuning Guidance

- Use `strict-writer` (default) for most applications. Writer connections provide the most accurate and timely topology information.
- Use `strict-reader` when you want to minimize load on the writer host and can tolerate slightly delayed topology updates.
- Use `writer-or-reader` for maximum monitoring availability at the cost of potentially connecting to a reader that may have slightly stale topology information.
- For Global Databases, prefer `strict-writer-primary` to get the most up-to-date topology from the primary region's writer.
- Use a specific region name when you want to keep monitoring traffic local to reduce cross-region latency.
