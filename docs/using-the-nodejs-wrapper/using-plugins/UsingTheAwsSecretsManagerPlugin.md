# AWS Secrets Manager Plugin

The AWS Advanced NodeJS Wrapper supports usage of database credentials stored as secrets in the [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/) through the AWS Secrets Manager Connection Plugin. When you create a new connection with this plugin enabled, the plugin will retrieve the secret and the connection will be created with the credentials inside that secret.

## Prerequisites

- This plugin requires the following packages to be installed:
  - [@aws-sdk/client-secrets-manager](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-secrets-manager/)

## Enabling the AWS Secrets Manager Connection Plugin

To enable the AWS Secrets Manager Connection Plugin, add the plugin code `secretsManager` to the [`plugins`](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) connection parameter.

This plugin requires a valid set of AWS credentials to retrieve the database credentials from AWS Secrets Manager. The AWS credentials must be located in [one of these locations](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-credential-providers/#fromNodeProviderChain) supported by the AWS SDK's default credentials provider. See also at [AWS Credentials Configuration](../custom-configuration/AwsCredentialsConfiguration.md)

## AWS Secrets Manager Connection Plugin Parameters

The following properties are required for the AWS Secrets Manager Connection Plugin to retrieve database credentials from the AWS Secrets Manager.

> [!NOTE]  
> To use this plugin, you will need to set the following AWS Secrets Manager specific parameters.

| Parameter        | Value  |              Required               | Description                                                                                                                                                                                                                       | Example                  | Default Value |
| ---------------- | :----: | :---------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------- | ------------- |
| `secretId`       | String |                 Yes                 | Set this value to be the secret name or the secret ARN.                                                                                                                                                                           | `secretId`               | `null`        |
| `secretRegion`   | String | Yes unless the `secretId` is an ARN | Set this value to be the region your secret is in.                                                                                                                                                                                | `us-east-2`              | `null`        |
| `secretEndpoint` | String |                 No                  | Set this value to be the endpoint override to retrieve your secret from. This parameter value should be in the form of a URL, with a valid protocol (ex. `https://`) and domain (ex. `localhost`). A port number is not required. | `https://localhost:1234` | `null`        |

> [!NOTE]  
> A Secret ARN has the following format: `arn:aws:secretsmanager:<Region>:<AccountId>:secret:SecretName-6RandomCharacters`

## Secret Data

The plugin assumes that the secret contains the following properties `username` and `password`.

### Example

Examples of making a connection using credentials fetched from the AWS Secrets Manager can be found at:
[PostgreSQL example](../../../examples/aws_driver_example/aws_secrets_manager_postgresql_example.ts) and [MySQL example](../../../examples/aws_driver_example/aws_secrets_manager_mysql_example.ts)
