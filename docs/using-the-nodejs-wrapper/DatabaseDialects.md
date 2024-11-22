# Database Dialects

## What are database dialects?

The AWS Advanced NodeJS Wrapper is a wrapper that requires an underlying driver, and it is meant to be compatible with any NodeJS driver. Database dialects help the AWS Advanced NodeJS Wrapper determine what kind of underlying database is being used. To function correctly, the AWS Advanced NodeJS Wrapper requires details unique to specific databases such as the default port number or the method to get the current host from the database. These details can be defined and provided to the AWS Advanced NodeJS Wrapper by using database dialects.

## Configuration Parameters

| Name      | Required             | Description                                                                        | Example                                       |
| --------- | -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| `dialect` | No (see notes below) | The [dialect code](#list-of-available-dialect-codes) of the desired database type. | `DialectCodes.AURORA_MYSQL` or `aurora-mysql` |

> [!NOTE]
> The `dialect` parameter is not required. When it is not provided by the user, the AWS Advanced NodeJS Wrapper will attempt to determine which of the existing dialects to use based on other connection details. However, if the dialect is known by the user, it is preferable to set the `dialect` parameter because it will take time to resolve the dialect.

### List of Available Dialect Codes

Dialect codes specify what kind of database any connections will be made to.

| Dialect Code Reference | Value                | Database                                                                                                                                           |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AURORA_MYSQL`         | `aurora-mysql`       | Aurora MySQL                                                                                                                                       |
| `RDS_MULTI_AZ_MYSQL`   | `rds-multi-az-mysql` | [Amazon RDS MySQL Multi-AZ DB Cluster Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)      |
| `RDS_MYSQL`            | `rds-mysql`          | Amazon RDS MySQL                                                                                                                                   |
| `MYSQL`                | `mysql`              | MySQL                                                                                                                                              |
| `AURORA_PG`            | `aurora-pg`          | Aurora PostgreSQL                                                                                                                                  |
| `RDS_MULTI_AZ_PG`      | `rds-multi-az-pg`    | [Amazon RDS PostgreSQL Multi-AZ DB Cluster Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html) |
| `RDS_PG`               | `rds-pg`             | Amazon RDS PostgreSQL                                                                                                                              |
| `PG`                   | `pg`                 | PostgreSQL                                                                                                                                         |
| `CUSTOM`               | `custom`             | See [custom dialects](#custom-dialects). This code is not required when using custom dialects.                                                     |

## Custom Dialects

If you are interested in using the AWS Advanced NodeJS Wrapper but your desired database type is not currently supported, it is possible to create a custom dialect.

To create a custom dialect, implement the [`DatabaseDialect`](../../common/lib/database_dialect/database_dialect.ts) interface. For databases clusters that are aware of their topology, the [`TopologyAwareDatabaseDialect`](../../common/lib/topology_aware_database_dialect.ts) interface should also be implemented. For database clusters that use an [Aurora Limitless Database](../../docs/using-the-nodejs-wrapper/using-plugins/UsingTheLimitlessConnectionPlugin.md#what-is-amazon-aurora-limitless-database) then [`LimitlessDatabaseDialect`](../../common/lib/database_dialect/limitless_database_dialect.ts) should be implemented.

See the following classes for examples:

- [PgDatabaseDialect](../../pg/lib/dialect/pg_database_dialect.ts)
  - This is a generic dialect that should work with any PostgreSQL database.
- [AuroraPgDatabaseDialect](../../pg/lib/dialect/aurora_pg_database_dialect.ts)
  - This dialect is an extension of PgDatabaseDialect, but also implements the `TopologyAwareDatabaseDialect` and `LimitlessDatabaseDialect` interface.
- [MySQLDatabaseDialect](../../mysql/lib/dialect/mysql_database_dialect.ts)
  - This is a generic dialect that should work with any MySQL database.
- [AuroraMySQLDatabaseDialect](../../mysql/lib/dialect/aurora_mysql_database_dialect.ts)
  - This dialect is an extension of MySQLDatabaseDialect, but also implements the `TopologyAwareDatabaseDialect` interface.

Once the custom dialect class has been created, tell the AWS Advanced NodeJS Wrapper to use it by setting a `customDatabaseDialect` parameter. It is not necessary to set the `dialect` parameter in this case. See below for an example:

```typescript
myDialect: DatabaseDialect = new CustomDialect();

const client = new AwsPGClient({
  ...
  customDatabaseDialect: myDialect
  ...
});

```
