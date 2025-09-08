# Connection Pool with the AWS Advanced NodeJS Wrapper

The AWS Advanced NodeJS Wrapper supports connection pool out of the box. The connection pool supports **promise-based** API compatible with the community drivers.
This documentation details AWS Advanced NodeJS Wrapper's Connection Pool configuration and usage, as well as how to
migrate to the AWS Pools from community drivers.

## Internal Connection Pooling

Internal connection pooling is an advanced feature that maintains connection pools for each database instance in a cluster. This is particularly useful with the Read/Write Splitting Plugin, where frequent calls to `setReadOnly()` can benefit from reusing existing connections rather than establishing new ones each time. When enabled, the wrapper creates internal pools that allow connections established by previous client objects to be reused, improving performance for applications that frequently switch between reader and writer instances.

## AWS Pool Config

| Property             | Type      | Default          | MySQL2 | node-postgres | Description                                                                       |
|----------------------|-----------|------------------|--------|---------------|-----------------------------------------------------------------------------------|
| `maxConnections`     | `number`  | `10`             | ✅      | ✅             | Maximum number of connections in the pool                                         |
| `idleTimeoutMillis`  | `number`  | `60000`          | ✅      | ✅             | Time in milliseconds before idle connections are closed                           |
| `waitForConnections` | `boolean` | `true`           | ✅      | ❌             | **MySQL only** - Whether to wait for available connections when pool is full      |
| `queueLimit`         | `number`  | `0`              | ✅      | ❌             | **MySQL only** - Maximum number of queued connection requests (0 = unlimited)     |
| `maxIdleConnections` | `number`  | `maxConnections` | ✅      | ❌             | **MySQL only** - Maximum number of idle connections to maintain                   |
| `maxLifetimeSeconds` | `number`  | `0`              | ❌      | ✅             | **PostgreSQL only** - Maximum lifetime of a connection in seconds (0 = unlimited) |
| `minConnections`     | `number`  | `0`              | ❌      | ✅             | **PostgreSQL only** - Minimum number of connections to maintain                   |
| `allowExitOnIdle`    | `boolean` | `false`          | ❌      | ✅             | **PostgreSQL only** - Allow the pool to close when all connections are idle       |

## MySQL2 Migration Guide

### Creating a Pool

To create a new Pool, with the `mysql2` community driver you would specify both the general connection properties and
the pool-specific properties at once like so:

```typescript
const pool = mysql.createPool({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db",
  connectionLimit: 10,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  queueLimit: 0
});
```

With the `AwsMySQLPoolClient`, provide the configuration separately like so:

```typescript
import { AwsMySQLPoolClient, AwsPoolConfig } from 'aws-advanced-nodejs-wrapper/mysql';

const poolConfig = new AwsPoolConfig({
  maxConnections: 10,
  maxIdleConnections: 3,
  idleTimeoutMillis: 300000,
  waitForConnections: true,
  queueLimit: 0
});

const pool = new AwsMySQLPoolClient({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db",
  wrapperQueryTimeout: 60000,
}, poolConfig);
```

All the pool-specific configuration parameters supported by `mysql2` are also supported by the wrapper. However, the
wrapper uses different parameter names, see the mapping below:

| mysql2 Parameter  | AwsPoolConfig Parameter | Type     | Default | Description                                                                                              |
|-------------------|-------------------------|----------|---------|----------------------------------------------------------------------------------------------------------|
| `connectionLimit` | `maxConnections`        | `number` | `10`    | Maximum number of connections in the pool                                                                |
| `acquireTimeout`  | `idleTimeoutMillis`     | `number` | `60000` | Time in milliseconds before idle connections are closed                                                  |
| `queueLimit`      | `queueLimit`            | `number` | `0`     | Maximum number of queued connection requests (0 = unlimited)                                             |
| `timeout`         | ❌ Not supported         | -        | -       | Query timeout can be set using the wrapperQueryTimeout parameter as part of the connection configuration |
| `reconnect`       | ❌ Not supported         | -        | -       | Auto-reconnect is handled by the failover plugin                                                         |

### Querying With the Pool Client

You can execute queries with the pool client directly, without having to first fetch a connection.
When you call `pool.query`, the client will fetch the first available connection or create one if not already created,
then execute the query.

#### Basic String Query

**mysql2:**

```typescript
const pool = mysql.createPool({ /* config */ });
const [rows] = await pool.query('SELECT NOW()');
console.log(rows[0]); // { 'NOW()': 2023-12-01T10:30:00.000Z }
```

**AwsMySQLPoolClient:**

```typescript
import { AwsMySQLPoolClient, AwsPoolConfig } from 'aws-advanced-nodejs-wrapper/mysql';

const pool = new AwsMySQLPoolClient({ /* config */ }, poolConfig);
const result = await pool.query('SELECT NOW()');
console.log(result[0][0]); // { 'NOW()': 2023-12-01T10:30:00.000Z }
```

#### Parameterized Query

**mysql2:**

```typescript
const [rows] = await pool.query('SELECT ? as name, ? as age', ['John', 25]);
console.log(rows[0]); // { name: 'John', age: 25 }
```

**AwsMySQLPoolClient:**

```typescript
const result = await pool.query('SELECT ? as name, ? as age', ['John', 25]);
console.log(result[0][0]); // { name: 'John', age: 25 }
```

#### Query with Options Object

**mysql2:**

```typescript
const [rows] = await pool.query({
  sql: 'SELECT ? as name, ? as age',
  values: ['Jane', 30]
});
console.log(rows[0]); // { name: 'Jane', age: 30 }
```

**AwsMySQLPoolClient:**

```typescript
const result = await pool.query({
  sql: 'SELECT ? as name, ? as age',
  values: ['Jane', 30]
});
console.log(result[0][0]); // { name: 'Jane', age: 30 }
```

#### Prepared Statement

**mysql2:**

```typescript
const [rows] = await pool.execute('SELECT ? as id, ? as status', [1, 'active']);
console.log(rows[0]); // { id: 1, status: 'active' }
```

**AwsMySQLPoolClient:**

```typescript
const result = await pool.execute('SELECT ? as id, ? as status', [1, 'active']);
console.log(result[0][0]); // { id: 1, status: 'active' }
``` 

## Node-Postgres Migration Guide

### Creating a Pool

To create a new Pool, with the `node-postgres` community driver you would specify both the general connection properties
and the pool-specific properties at once like so:

```typescript
const pool = new Pool({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  maxLifetimeSeconds: 60
})
```

With the `AwsPgPoolClient`, provide the configuration separately like so:

```typescript
import { AwsPgPoolClient, AwsPoolConfig } from 'aws-advanced-nodejs-wrapper/pg';

const poolConfig = new AwsPoolConfig({
  maxConnections: 10,
  minConnections: 2,
  idleTimeoutMillis: 300000,
  maxLifetimeSeconds: 60
});

const pool = new AwsPgPoolClient({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db"
}, poolConfig);
```

All the [pool-specific configuration parameters](https://node-postgres.com/apis/pool#new-pool) supported by
`node-postgres` are also supported by the wrapper.
However, the wrapper uses different parameter names, see the mapping below:

| node-postgres Parameter   | AwsPoolConfig Parameter | Type      | Default | Description                                                                                                     |
|---------------------------|-------------------------|-----------|---------|-----------------------------------------------------------------------------------------------------------------|
| `max`                     | `maxConnections`        | `number`  | `10`    | Maximum number of connections in the pool                                                                       |
| `min`                     | `minConnections`        | `number`  | `0`     | Minimum number of connections to maintain                                                                       |
| `idleTimeoutMillis`       | `idleTimeoutMillis`     | `number`  | `60000` | Time in milliseconds before idle connections are closed                                                         |
| `allowExitOnIdle`         | `allowExitOnIdle`       | `boolean` | `false` | Allow the pool to close when all connections are idle                                                           |
| `maxLifetimeSeconds`      | `maxLifetimeSeconds`    | `number`  | `0`     | Maximum lifetime of a connection in seconds (0 = unlimited)                                                     |
| `connectionTimeoutMillis` | ❌ Not supported         | -         | -       | Connection timeout can be set using the wrapperConnectTimeout parameter as part of the connection configuration |

### Querying With the Pool Client

You can execute queries with the pool client directly, without having to first fetch a connection.
When you call `pool.query`, the client will fetch the first available connection or create one if not already created,
then execute the query.

#### Basic String Query

**node-postgres:**

```typescript
const pool = new Pool({ /* config */ });
const result = await pool.query('SELECT NOW()');
console.log(result.rows[0]); // { now: 2023-12-01T10:30:00.000Z }
```

**AwsPgPoolClient:**

```typescript
import { AwsPgPoolClient, AwsPoolConfig } from 'aws-advanced-nodejs-wrapper/pg';

const pool = new AwsPgPoolClient({ /* config */ }, poolConfig);
const result = await pool.query('SELECT NOW()');
console.log(result.rows[0]); // { now: 2023-12-01T10:30:00.000Z }
```

#### Parameterized Query

**node-postgres:**

```typescript
const result = await pool.query('SELECT $1::text as name, $2::int as age', ['John', 25]);
console.log(result.rows[0]); // { name: 'John', age: 25 }
```

**AwsPgPoolClient:**

```typescript
const result = await pool.query('SELECT $1::text as name, $2::int as age', ['John', 25]);
console.log(result.rows[0]); // { name: 'John', age: 25 }
```

#### Query with Config Object

**node-postgres:**

```typescript
const result = await pool.query({
  text: 'SELECT $1::text as name, $2::int as age',
  values: ['Jane', 30]
});
console.log(result.rows[0]); // { name: 'Jane', age: 30 }
```

**AwsPgPoolClient:**

```typescript
const result = await pool.query({
  text: 'SELECT $1::text as name, $2::int as age',
  values: ['Jane', 30]
});
console.log(result.rows[0]); // { name: 'Jane', age: 30 }
```

#### Array Row Mode

**node-postgres:**

```typescript
const result = await pool.query({
  text: 'SELECT $1::int as id, $2::text as status',
  values: [1, 'active'],
  rowMode: 'array'
});
console.log(result.rows[0]); // [1, 'active']
```

**AwsPgPoolClient:**

```typescript
const result = await pool.query({
  text: 'SELECT $1::int as id, $2::text as status',
  values: [1, 'active'],
  rowMode: 'arra'
});
console.log(result.rows[0]); // [1, 'active']
```

#### Named Prepared Statement

**node-postgres:**

```typescript
const result = await pool.query({
  name: 'fetch-data',
  text: 'SELECT $1::int as id, $2::text as name',
  values: [1, 'test']
});
console.log(result.rows[0]); // { id: 1, name: 'test' }
```

**AwsPgPoolClient:**

```typescript
const result = await pool.query({
  name: 'fetch-data',
  text: 'SELECT $1::int as id, $2::text as name',
  values: [1, 'test']
});
console.log(result.rows[0]); // { id: 1, name: 'test' }
```

## Limitation

The AWS Advanced NodeJS Wrapper is a promise-based library and do not support callbacks.
The community drivers' Connection Pool APIs supporting callbacks are not compatible with this wrapper.

### Unsupported Callback Examples

**MySQL2 callback API (not supported):**
```typescript
// ❌ This will NOT work with AwsMySQLPoolClient
pool.query('SELECT NOW()', (error, results, fields) => {
  if (error) {
    throw error;
  };
  console.log(results[0]);
});
```

**node-postgres callback API (not supported):**
```typescript
// ❌ This will NOT work with AwsPgPoolClient
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    throw err;
  };
  console.log(result.rows[0]);
});
```

## Common Pitfalls

### Pooled Connections

If your application is fetching individual connections from the pool via `conn = await pool.connect()` or `conn = await pool.getConnection()`.
Ensure your application does not fetch more connections than the max number of connections allowed in the pool, otherwise the application may hang indefinitely depending on community driver behaviour.
See the [warning](https://node-postgres.com/apis/pool#releasing-clients) for `node-postgres` for instance.

```typescript
import { AwsPgPoolClient, AwsPoolConfig } from 'aws-advanced-nodejs-wrapper/pg';

const poolConfig = new AwsPoolConfig({ maxConnections: 10 });
const pool = new AwsPgPoolClient({ /* connection parameters */ }, poolConfig);

// Fetch 10 connections (pool limit)
const connections = [];
for (let i = 0; i < 10; i++) {
  connections.push(await pool.connect());
}

// Return connections to pool before using pool.query()
for (const conn of connections) {
  conn.release();
}

// Attempting to query directly via the pool when number of active connections have already reached the maxConnections limit may result in the application hanging.
const result = await pool.query('SELECT NOW()');
```

### Resources Cleanup

Throughout the application lifetime, some plugins like the Aurora Connection Tracker Plugin or the Host Monitoring Connection Plugin may create background threads shared by all connections.

At the end of your application, call `PluginManager.releaseResources()` to clean up these shared resources.

```typescript
await PluginManager.releaseResources();
```

## External Connection Pool vs Internal Connection Pool

The external connection pool via AwsPgPoolClient and AwsMySQLPoolClient creates a pool for the initial connection endpoint.
You can interact with this client directly using `pool.query()` or with individual pooled connections during transactions.

The AWS Advanced NodeJS Wrapper also supports the [internal connection pool](using-plugins/UsingTheReadWriteSplittingPlugin.md#internal-connection-pooling).
This feature works with the Read/Write Splitting Plugin. When enabled, it creates a connection pool for each database instance in an Aurora or RDS cluster.
This is useful for applications that frequently call `setReadOnly()` to redirect traffic between instances.

You can use both pool types together, but it's recommended to use only one type that best suits your use case.
External connection pooling already pools all connections. Adding internal connection pooling creates unnecessary overhead without additional value.
