# Plugin Pipeline Performance Results

## Benchmarks

| Method                         | Ops/Second |
| ------------------------------ | ---------- |
| connect0Plugins                | 339987.90  |
| connect1Plugins                | 285332.10  |
| connect2Plugins                | 258645.40  |
| connect5Plugins                | 176134.80  |
| connect10Plugins               | 121929.60  |
| connectDefaultPlugins          | 322837.80  |
| execute0Plugins                | 466016.50  |
| execute1Plugins                | 368192.00  |
| execute2Plugins                | 327689.50  |
| execute5Plugins                | 217303.90  |
| execute10Plugins               | 139890.50  |
| executeDefaultPlugins          | 493716.70  |
| releaseResources0Plugins       | 8116756.80 |
| releaseResources1Plugins       | 4844478.00 |
| releaseResources2Plugins       | 3121529.30 |
| releaseResources5Plugins       | 1592138.20 |
| releaseResources10Plugins      | 941274.60  |
| releaseResourcesDefaultPlugins | 2127998.90 |

## Performance Tests

The failure detection performance tests below will execute a long query, and monitoring will not begin until the `FailureDetectionGraceTime` has passed. A network outage will be triggered after the `NetworkOutageDelayMillis` has passed. The `FailureDetectionInterval` multiplied by the `FailureDetectionCount` represents how long the monitor will take to detect a failure once it starts sending probes to the host. This value combined with the time remaining from `FailureDetectionGraceTime` after the network outage is triggered will result in the expected failure detection time.

For more information please refer to the [failover specific performance tests section](DevelopmentGuide.md#failover-specific-performance-tests).

### Enhanced Failure Monitoring Performance with Different Failure Detection Configuration

| FailureDetectionGraceTime | FailureDetectionInterval | FailureDetectionCount | NetworkOutageDelayMillis | MinFailureDetectionTimeMillis | MaxFailureDetectionTimeMillis | AvgFailureDetectionTimeMillis |
| ------------------------- | ------------------------ | --------------------- | ------------------------ | ----------------------------- | ----------------------------- | ----------------------------- |
| 30000                     | 5000                     | 3                     | 5000                     | 35524                         | 35538                         | 35530                         |
| 30000                     | 5000                     | 3                     | 10000                    | 30523                         | 30527                         | 30525                         |
| 30000                     | 5000                     | 3                     | 15000                    | 25524                         | 25532                         | 25527                         |
| 30000                     | 5000                     | 3                     | 20000                    | 20520                         | 20528                         | 20525                         |
| 30000                     | 5000                     | 3                     | 25000                    | 15523                         | 15532                         | 15527                         |
| 30000                     | 5000                     | 3                     | 30000                    | 10524                         | 10531                         | 10528                         |
| 30000                     | 5000                     | 3                     | 35000                    | 10519                         | 10537                         | 10528                         |
| 30000                     | 5000                     | 3                     | 40000                    | 10526                         | 10532                         | 10529                         |
| 30000                     | 5000                     | 3                     | 50000                    | 10522                         | 10532                         | 10528                         |
| 30000                     | 5000                     | 3                     | 60000                    | 10526                         | 10543                         | 10534                         |
| 6000                      | 1000                     | 1                     | 1000                     | 5523                          | 5533                          | 5530                          |
| 6000                      | 1000                     | 1                     | 2000                     | 4525                          | 4553                          | 4532                          |
| 6000                      | 1000                     | 1                     | 3000                     | 3524                          | 3535                          | 3527                          |
| 6000                      | 1000                     | 1                     | 4000                     | 2525                          | 2531                          | 2528                          |
| 6000                      | 1000                     | 1                     | 5000                     | 1522                          | 1528                          | 1525                          |
| 6000                      | 1000                     | 1                     | 6000                     | 923                           | 933                           | 927                           |
| 6000                      | 1000                     | 1                     | 7000                     | 921                           | 949                           | 930                           |
| 6000                      | 1000                     | 1                     | 8000                     | 922                           | 934                           | 928                           |
| 6000                      | 1000                     | 1                     | 9000                     | 929                           | 933                           | 931                           |
| 6000                      | 1000                     | 1                     | 10000                    | 918                           | 947                           | 931                           |

### Failover Performance with Different Enhanced Failure Monitoring Configuration

| FailureDetectionGraceTime | FailureDetectionInterval | FailureDetectionCount | NetworkOutageDelayMillis | MinFailureDetectionTimeMillis | MaxFailureDetectionTimeMillis | AvgFailureDetectionTimeMillis |
| ------------------------- | ------------------------ | --------------------- | ------------------------ | ----------------------------- | ----------------------------- | ----------------------------- |
| 30000                     | 5000                     | 3                     | 5000                     | 35525                         | 35528                         | 35526                         |
| 30000                     | 5000                     | 3                     | 10000                    | 30523                         | 30546                         | 30530                         |
| 30000                     | 5000                     | 3                     | 15000                    | 25523                         | 25528                         | 25525                         |
| 30000                     | 5000                     | 3                     | 20000                    | 20522                         | 20541                         | 20531                         |
| 30000                     | 5000                     | 3                     | 25000                    | 15523                         | 15533                         | 15527                         |
| 30000                     | 5000                     | 3                     | 30000                    | 10518                         | 10532                         | 10526                         |
| 30000                     | 5000                     | 3                     | 35000                    | 10523                         | 10539                         | 10532                         |
| 30000                     | 5000                     | 3                     | 40000                    | 10522                         | 10536                         | 10530                         |
| 30000                     | 5000                     | 3                     | 50000                    | 10529                         | 10537                         | 10533                         |
| 30000                     | 5000                     | 3                     | 60000                    | 10529                         | 10536                         | 10532                         |
| 6000                      | 1000                     | 1                     | 1000                     | 5524                          | 5531                          | 5528                          |
| 6000                      | 1000                     | 1                     | 2000                     | 4531                          | 4554                          | 4539                          |
| 6000                      | 1000                     | 1                     | 3000                     | 3523                          | 3550                          | 3530                          |
| 6000                      | 1000                     | 1                     | 4000                     | 2520                          | 2525                          | 2523                          |
| 6000                      | 1000                     | 1                     | 5000                     | 1507                          | 1538                          | 1526                          |
| 6000                      | 1000                     | 1                     | 6000                     | 924                           | 928                           | 926                           |
| 6000                      | 1000                     | 1                     | 7000                     | 925                           | 930                           | 928                           |
| 6000                      | 1000                     | 1                     | 8000                     | 920                           | 933                           | 926                           |
| 6000                      | 1000                     | 1                     | 9000                     | 922                           | 929                           | 927                           |
| 6000                      | 1000                     | 1                     | 10000                    | 925                           | 937                           | 930                           |
