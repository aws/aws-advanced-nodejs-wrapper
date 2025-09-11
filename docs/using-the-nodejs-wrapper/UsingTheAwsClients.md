# Using the AWS Advanced NodeJS Wrapper Clients

The AWS Advanced NodeJS Wrapper is a promise-based library that is compatible with the MySQL2 and Node-Postgres community drivers' **promise-based** APIs.
Callback APIs from community drivers are not supported by the wrapper.

### Callback APIs (Not Supported)

**MySQL2 callback API (not supported):**

```typescript
// ❌ This will NOT work with AwsMySQLClient
import mysql from "mysql2";

const connection = mysql.createConnection({
  /* config */
});
connection.query("SELECT NOW()", (error, results, fields) => {
  if (error) throw error;
  console.log(results[0]);
});
```

**Node-Postgres callback API (not supported):**

```typescript
// ❌ This will NOT work with AwsPGClient
import { Client } from "pg";

const client = new Client({
  /* config */
});
client.connect();
client.query("SELECT NOW()", (err, result) => {
  if (err) throw err;
  console.log(result.rows[0]);
});
```

### Promise-Based APIs (Supported)

**MySQL2 promise-based API:**

```typescript
import { createConnection } from "mysql2/promise";

const connection = await createConnection({
  /* config */
});
const [rows] = await connection.query("SELECT NOW()");
console.log(rows[0]);
```

**Node-Postgres promise-based API:**

```typescript
import { Client } from "pg";

const client = new Client({
  /* config */
});
await client.connect();
const result = await client.query("SELECT NOW()");
console.log(result.rows[0]);
```

If your application is already using promise-based APIs, migrating from community drivers to the wrapper requires minimal modification to existing execution workflows.
See the sections below for examples of how community driver APIs map to the wrapper APIs.

> [!WARNING]\
> The imports and query parsing shown in these examples are only compatible with AWS Advanced NodeJS Wrapper versions 2.0.0 and above.
> If you are using versions 1.3.0 and earlier, see the [sample code from version 1.3.0](https://github.com/aws/aws-advanced-nodejs-wrapper/tree/1.3.0/examples/aws_driver_example).

## MySQL2 Migration Guide

### Creating a Client

**mysql2:**

```typescript
import { createConnection } from "mysql2/promise";

const connection = await createConnection({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db",
  port: 3306
});
```

**AwsMySQLClient:**

```typescript
import { AwsMySQLClient } from "aws-advanced-nodejs-wrapper/mysql";

const client = new AwsMySQLClient({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db",
  port: 3306
});

await client.connect();
```

### Querying With the Client

#### Basic String Query

**mysql2:**

```typescript
const [rows] = await connection.query("SELECT NOW()");
console.log(rows[0]); // { "NOW()": 2023-12-01T10:30:00.000Z }
```

**AwsMySQLClient:**

```typescript
const [rows] = await client.query("SELECT NOW()");
console.log(rows[0]); // { "NOW()": 2023-12-01T10:30:00.000Z }
```

#### Parameterized Query

**mysql2:**

```typescript
const [rows] = await connection.query("SELECT ? as name, ? as age", ["John", 25]);
console.log(rows[0]); // { name: "John", age: 25 }
console.log(rows[0].name); // "John"
console.log(rows[0].age); // 25
```

**AwsMySQLClient:**

```typescript
const [rows] = await client.query("SELECT ? as name, ? as age", ["John", 25]);
console.log(rows[0]); // { name: "John", age: 25 }
console.log(rows[0].name); // "John"
console.log(rows[0].age); // 25
```

#### Query with Options Object

**mysql2:**

```typescript
const [rows] = await connection.query({
  sql: "SELECT ? as name, ? as age",
  values: ["Jane", 30]
});
console.log(rows[0]); // { name: "Jane", age: 30 }
console.log(rows[0].name); // "Jane"
console.log(rows[0].age); // 30
```

**AwsMySQLClient:**

```typescript
const [rows] = await client.query({
  sql: "SELECT ? as name, ? as age",
  values: ["Jane", 30]
});
console.log(rows[0]); // { name: "Jane", age: 30 }
console.log(rows[0].name); // "Jane"
console.log(rows[0].age); // 30
```

#### Prepared Statement

**mysql2:**

```typescript
const [rows] = await connection.execute("SELECT ? as id, ? as status", [1, "active"]);
console.log(rows[0]); // { id: 1, status: "active" }
console.log(rows[0].id); // 1
console.log(rows[0].status); // "active"
```

**AwsMySQLClient:**

```typescript
const [rows] = await client.execute("SELECT ? as id, ? as status", [1, "active"]);
console.log(rows[0]); // { id: 1, status: "active" }
console.log(rows[0].id); // 1
console.log(rows[0].status); // "active"
```

## Node-Postgres Migration Guide

### Creating a Client

**node-postgres:**

```typescript
import { Client } from "pg";

const client = new Client({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db",
  port: 5432
});

await client.connect();
```

**AwsPGClient:**

```typescript
import { AwsPGClient } from "aws-advanced-nodejs-wrapper/pg";

const client = new AwsPGClient({
  host: "cluster-endpoint",
  user: "database-user",
  password: "database-pwd",
  database: "db",
  port: 5432
});

await client.connect();
```

### Querying With the Client

#### Basic String Query

**node-postgres:**

```typescript
const result = await client.query("SELECT NOW()");
console.log(result.rows[0]); // { now: 2023-12-01T10:30:00.000Z }
```

**AwsPGClient:**

```typescript
const result = await client.query("SELECT NOW()");
console.log(result.rows[0]); // { now: 2023-12-01T10:30:00.000Z }
```

#### Parameterized Query

**node-postgres:**

```typescript
const result = await client.query("SELECT $1::text as name, $2::int as age", ["John", 25]);
console.log(result.rows[0]); // { name: 'John', age: 25 }
```

**AwsPGClient:**

```typescript
const result = await client.query("SELECT $1::text as name, $2::int as age", ["John", 25]);
console.log(result.rows[0]); // { name: 'John', age: 25 }
```

#### Query with Config Object

**node-postgres:**

```typescript
const result = await client.query({
  text: "SELECT $1::text as name, $2::int as age",
  values: ["Jane", 30]
});
console.log(result.rows[0]); // { name: 'Jane', age: 30 }
```

**AwsPGClient:**

```typescript
const result = await client.query({
  text: "SELECT $1::text as name, $2::int as age",
  values: ["Jane", 30]
});
console.log(result.rows[0]); // { name: 'Jane', age: 30 }
```

#### Array Row Mode

**node-postgres:**

```typescript
const result = await client.query({
  text: "SELECT $1::int as id, $2::text as status",
  values: [1, "active"],
  rowMode: "array"
});
console.log(result[0]); // [1, 'active']
```

**AwsPGClient:**

```typescript
const result = await client.query({
  text: "SELECT $1::int as id, $2::text as status",
  values: [1, "active"],
  rowMode: "array"
});
console.log(result[0]); // [1, 'active']
```

#### Named Prepared Statement

**node-postgres:**

```typescript
const result = await client.query({
  name: "fetch-data",
  text: "SELECT $1::int as id, $2::text as name",
  values: [1, "test"]
});
console.log(result.rows[0]); // { id: 1, name: 'test' }
```

**AwsPGClient:**

```typescript
const result = await client.query({
  name: "fetch-data",
  text: "SELECT $1::int as id, $2::text as name",
  values: [1, "test"]
});
console.log(result.rows[0]); // { id: 1, name: 'test' }
```

# Sample Code

For sample JavaScript and TypeScript projects using the AWS Advanced NodeJS Wrapper, see the following directories:

- [JavaScript Example](../../examples/javascript_example)
- [TypeScript Example](../../examples/typescript_example)
