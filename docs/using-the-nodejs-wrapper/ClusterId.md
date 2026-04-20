# Understanding the clusterId Parameter

## Overview

The `clusterId` parameter is a critical configuration setting when using the AWS Advanced NodeJS Wrapper to **connect to multiple database clusters within a single application**. This parameter serves as a unique identifier that enables the driver to maintain separate caches and state for each distinct database cluster your application connects to.

## What is a Cluster?

Understanding what constitutes a cluster is crucial for correctly setting the `clusterId` parameter. In the context of the AWS Advanced NodeJS Wrapper, a **cluster** is a logical grouping of database instances that should share the same topology cache and monitoring services.

A cluster represents one writer instance (primary) and zero or more reader instances (replicas). These make up shared topology that the driver needs to track, and are the group of instances the driver can reconnect to when a failover is detected.

### Examples of Clusters

- Aurora DB Cluster (one writer + multiple readers)
- RDS Multi-AZ DB Cluster (one writer + two readers)
- Aurora Global Database (when supplying a global db endpoint, the driver considers them as a single cluster)

> **Rule of thumb:** If the driver should track separate topology information and perform independent failover operations, use different `clusterId` values. If instances share the same topology and failover domain, use the same `clusterId`.

## Why clusterId is Important

The AWS Advanced NodeJS Wrapper uses the `clusterId` as a **key for internal caching mechanisms** to optimize performance and maintain cluster-specific state. Without proper `clusterId` configuration, your application may experience:

- Cache collisions between different clusters
- Incorrect topology information
- Degraded performance due to cache invalidation

## Why Not Use AWS DB Cluster Identifiers?

Host information can take many forms:

- **IP Address Connections:** `10.0.1.50` ← No cluster info!
- **Custom Domain Names:** `db.mycompany.com` ← Custom domain
- **Custom Endpoints:** `my-custom-endpoint.cluster-custom-abc.us-east-1.rds.amazonaws.com` ← Custom endpoint
- **Proxy Connections:** `my-proxy.proxy-abc.us-east-1.rds.amazonaws.com` ← Proxy, not actual cluster

In fact, all of these could reference the exact same cluster. Therefore, because the driver cannot reliably parse cluster information from all connection types, **it is up to the user to explicitly provide the `clusterId`**.

## How clusterId is Used Internally

The driver uses `clusterId` as a cache key for topology information and monitoring services. This enables multiple connections to the same cluster to share cached data and avoid redundant db meta-data.

### Example: Single Cluster with Multiple Connections

The following diagram shows how connections with the same `clusterId` share cached resources:

![Single Cluster Example](../images/cluster_id_one_cluster_example.png)

**Key Points:**

- Three connections use different connection strings (custom endpoint, IP address, cluster endpoint) but all specify **`clusterId: "foo"`**
- All three connections share the same Topology Cache and Monitor Threads in the driver
- The Topology Cache stores a key-value mapping where `"foo"` maps to `["instance-1", "instance-2", "instance-3"]`
- Despite different connection URLs, all connections monitor and query the same physical database cluster

**The Impact:**
Shared resources eliminate redundant topology queries and reduce monitoring overhead.

### Example: Multiple Clusters with Separate Cache Isolation

The following diagram shows how different `clusterId` values maintain separate caches for different clusters.

![Two Cluster Example](../images/cluster_id_two_cluster_example.png)

**Key Points:**

- Connection 1 and 3 use **`clusterId: "foo"`** and share the same cache entries
- Connection 2 uses **`clusterId: "bar"`** and has completely separate cache entries
- Each `clusterId` acts as a key in the cache Map structure: `Map<String, CacheValue>`
- Topology Cache maintains separate entries: `"foo"` → `[instance-1, instance-2, instance-3]` and `"bar"` → `[instance-4, instance-5]`
- Monitor Cache maintains separate monitor threads for each cluster
- Monitors poll their respective database clusters and update the corresponding topology cache entries

**The Impact:**
This isolation prevents cache collisions and ensures correct failover behavior for each cluster.

## When to Specify clusterId

### Required: Multiple Clusters in One Application

You **must** specify a unique `clusterId` for every DB cluster when your application connects to multiple database clusters:

```typescript
// Sample data migration app
const sourceParams = {
  host: "source-db.us-east-1.rds.amazonaws.com",
  port: 5432,
  user: "admin",
  password: "***",
  database: "mydb",
  clusterId: "source-cluster"
};
const sourceClient = new AwsPGClient(sourceParams);
await sourceClient.connect();

const destParams = {
  host: "dest-db.us-west-2.rds.amazonaws.com",
  port: 5432,
  user: "admin",
  password: "***",
  database: "mydb",
  clusterId: "destination-cluster" // Different clusterId!
};
const destClient = new AwsPGClient(destParams);
await destClient.connect();

// Read from source, write to destination
const result = await sourceClient.query("SELECT * FROM users");
// ... migration logic

// If you are connecting `source-db` with a different host later on, use the same clusterId
const sourceIpParams = {
  host: "10.0.0.1",
  port: 5432,
  user: "admin",
  password: "***",
  database: "mydb",
  clusterId: "source-cluster" // Same ID as sourceClient
};
const sourceIpClient = new AwsPGClient(sourceIpParams);
await sourceIpClient.connect();
```

### Optional: Single Cluster Applications

If your application only connects to one cluster, you can omit `clusterId` (defaults to `"1"`):

```typescript
// Single cluster - clusterId defaults to "1"
const params = {
  host: "my-cluster.us-east-1.rds.amazonaws.com",
  port: 5432,
  user: "admin",
  password: "***",
  database: "mydb"
};
const client = new AwsPGClient(params);
await client.connect();
```

This also includes if you have multiple connections using different host information:

```typescript
const params = {
  host: "my-cluster.us-east-1.rds.amazonaws.com",
  port: 5432,
  user: "admin",
  password: "***",
  database: "mydb"
  // clusterId defaults to "1"
};
const urlClient = new AwsPGClient(params);
await urlClient.connect();

// "10.0.0.1" -> IP address of source-db. So it is the same cluster.
const ipParams = {
  host: "10.0.0.1",
  port: 5432,
  user: "admin",
  password: "***",
  database: "mydb"
  // clusterId defaults to "1"
};
const ipClient = new AwsPGClient(ipParams);
await ipClient.connect();
```

## Critical Warnings

### NEVER Share clusterId Between Different Clusters

Using the same `clusterId` for different database clusters will cause serious issues:

```typescript
// ❌ WRONG - Same clusterId for different clusters
const sourceParams = {
  host: "source-db.us-east-1.rds.amazonaws.com",
  clusterId: "shared-id" // ← BAD!
  // ...
};

const destParams = {
  host: "dest-db.us-west-2.rds.amazonaws.com",
  clusterId: "shared-id" // ← BAD! Same ID for different cluster
  // ...
};
```

**Problems this causes:**

- Topology cache collision (dest-db's topology could overwrite source-db's)
- Incorrect failover behavior (driver may try to failover to wrong cluster)
- Monitor conflicts (Only one monitor instance for both clusters will lead to undefined results)

**Correct approach:**

```typescript
// ✅ CORRECT - Unique clusterId for each cluster
const sourceParams = { clusterId: "source-cluster" /* ... */ };
const destParams = { clusterId: "destination-cluster" /* ... */ };
```

### Always Use Same clusterId for Same Cluster

Using different `clusterId` values for the same cluster reduces efficiency:

```typescript
// ⚠️ SUBOPTIMAL - Different clusterIds for same cluster
const params1 = {
  host: "my-cluster.us-east-1.rds.amazonaws.com",
  clusterId: "my-cluster-1"
  // ...
};

const params2 = {
  host: "my-cluster.us-east-1.rds.amazonaws.com",
  clusterId: "my-cluster-2" // Different ID for same cluster
  // ...
};
```

**Problems this causes:**

- Duplication of caches
- Multiple monitoring threads for the same cluster

**Best practice:**

```typescript
// ✅ BEST - Same clusterId for same cluster
const CLUSTER_ID = "my-cluster";
const params1 = { clusterId: CLUSTER_ID /* ... */ };
const params2 = { clusterId: CLUSTER_ID /* ... */ }; // Shared cache and resources
```

## Summary

The `clusterId` parameter is essential for applications connecting to multiple database clusters. It serves as a cache key for topology information and monitoring services. Always use unique `clusterId` values for different clusters, and consistent values for the same cluster to maximize performance and avoid conflicts.
