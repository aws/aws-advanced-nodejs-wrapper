# Driver Dialects

## What are Driver Dialects?

The AWS Advanced NodeJS Wrapper is a wrapper that requires an underlying driver, and it is meant to be compatible with any NodeJS driver. Driver dialects help the AWS Advanced NodeJS Wrapper to properly pass calls to a target driver. To function correctly, the AWS Advanced NodeJS Wrapper requires details unique to the specific target driver such as the method to create the current connection, whether to include some specific connection parameters, etc. These details can be defined and provided to the AWS Advanced NodeJS Wrapper by using driver dialects.

To get a connection with the AWS Advanced NodeJS Wrapper, the user application can create a client object and connect. The database type being connected to determines the client and the driver dialect.

### List of Available Driver Dialects

| Database Type | Client           | Driver Dialect              | Underlying Node Driver                                   |
| ------------- | ---------------- | --------------------------- | -------------------------------------------------------- |
| MySQL         | `AwsMySQLClient` | `MySQL2DriverDialect`       | [node-postgres](https://github.com/brianc/node-postgres) |
| PostgreSQL    | `AwsPgClient`    | `NodePostgresDriverDialect` | [node-mysql2](https://github.com/sidorares/node-mysql2)  |
