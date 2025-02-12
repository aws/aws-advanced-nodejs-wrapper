# Custom Endpoint Plugin

The Custom Endpoint Plugin adds support for [RDS custom endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Custom.html). When the Custom Endpoint Plugin is in use, the driver will analyse custom endpoint information to ensure instances used in connections are part of the custom endpoint being used. This includes connections used in failover and read-write splitting.

## Prerequisites

- This plugin requires the following packages to be installed:
  - [@aws-sdk/client-rds](https://www.npmjs.com/package/@aws-sdk/client-rds)

## How to use the Custom Endpoint Plugin with the AWS Advanced NodeJS Wrapper

### Enabling the Custom Endpoint Plugin

1. If needed, create a custom endpoint using the AWS RDS Console:
   - If needed, review the documentation about [creating a custom endpoint](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-custom-endpoint-creating.html).
2. Add the plugin code `customEndpoint` to the [`plugins`](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) value, or to the current [driver profile](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters).
3. If you are using the failover plugin, set the failover parameter `failoverMode` according to the custom endpoint type. For example, if the custom endpoint you are using is of type `READER`, you can set `failoverMode` to `strict-reader`, or if it is of type `ANY`, you can set `failoverMode` to `reader-or-writer`.
4. Specify parameters that are required or specific to your case.

### Custom Endpoint Plugin Parameters

| Parameter                            |  Value  | Required | Description                                                                                                                                                                                                                                                                                                                          | Default Value         | Example Value |
| ------------------------------------ | :-----: | :------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------- |
| `customEndpointRegion`               | String  |    No    | The region of the cluster's custom endpoints. If not specified, the region will be parsed from the URL.                                                                                                                                                                                                                              | `null`                | `us-west-1`   |
| `customEndpointInfoRefreshRateMs`    | number  |    No    | Controls how frequently custom endpoint monitors fetch custom endpoint info, in milliseconds.                                                                                                                                                                                                                                        | `10000`               | `20000`       |
| `customEndpointMonitorExpirationMs`  | number  |    No    | Controls how long a monitor should run without use before expiring and being removed, in milliseconds.                                                                                                                                                                                                                               | `900000` (15 minutes) | `600000`      |
| `waitForCustomEndpointInfo`          | boolean |    No    | Controls whether to wait for custom endpoint info to become available before connecting or executing a method. Waiting is only necessary if a connection to a given custom endpoint has not been opened or used recently. Note that disabling this may result in occasional connections to instances outside of the custom endpoint. | `true`                | `true`        |
| `waitForCustomEndpointInfoTimeoutMs` | number  |    No    | Controls the maximum amount of time that the plugin will wait for custom endpoint info to be made available by the custom endpoint monitor, in milliseconds.                                                                                                                                                                         | `10000`               | `7000`        |
