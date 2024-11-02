# Read/Write Splitting Performance Results

When calling `AwsClient#setReadOnly`, the AWS Advanced NodeJS Wrapper will execute a query that sets the current session transaction state.
For a PostgreSQL database, the wrapper will execute either a `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` or a `SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE` query, and for a MySQL database,
the wrapper will execute either a `SET SESSION TRANSACTION READ ONLY` or a `SET SESSION TRANSACTION READ WRITE` query.

If the Read/Write Splitting Plugin is enabled, in addition to executing the queries mentioned above,
the wrapper will also switch the current underlying connection from a writer instance to a reader instance, and vice versa, depending on the requested readonly state.
To reduce the overhead of creating new connections each time `setReadOnly` is called, the wrapper keeps the previous connection opened for reusability.

The Read/Write Splitting Performance Test measures the overhead of this additional connection creation and caching workflow.
In this test, the wrapper first establishes the initial connection to a writer instance A using the cluster writer endpoint, then:
1. switches to a new reader B by calling `AwsClient#setReadOnly(true)`, represented by `Switch to reader` in the table below.
2. switches back to the initial writer A by calling `AwsClient#setReadOnly(false)`, represented by `Switch to reader (using cached connection)` in the table below.
3. switches back to reader B by calling `AwsClient#setReadOnly(true)`, represented by `Switch to reader (using cached connection)` in the table below.

The numbers in the table below are in nanoseconds, and do not account for network latency from operations that require network connections, such as executing queries or establishing new connections.

| ConnectionSwitch                           | MinOverheadTime (ns) | MaxOverheadTime (ns) | AvgOverheadTime (ns) |
|--------------------------------------------|----------------------|----------------------|----------------------|
| Switch to reader                           | 69597293             | 83459751             | 77004721             |
| Switch to writer (using cached connection) | 141619751            | 167699666            | 151332779            |
| Switch to reader (using cached connection) | 138624375            | 159564291            | 150139892            |


When using the Read/Write Splitting plugin, users should expect at least a 15 milliseconds delay when not using internal connection pools.
