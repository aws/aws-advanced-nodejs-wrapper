# AWS IAM Authentication Plugin

## What is IAM?

AWS Identity and Access Management (IAM) grants users access control across all Amazon Web Services. IAM supports granular permissions, giving you the ability to grant different permissions to different users. For more information on IAM and it's use cases, please refer to the [IAM documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html).

## AWS IAM Database Authentication

The AWS Advanced NodeJS Wrapper supports Amazon AWS Identity and Access Management (IAM) authentication. When using AWS IAM database authentication, the host URL must be a valid Amazon endpoint, and not a custom domain or an IP address.
<br>ie. `db-identifier.cluster-XYZ.us-east-2.rds.amazonaws.com`

IAM database authentication use is limited to certain database engines. For more information on limitations and recommendations, please [review the IAM documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html).

## Prerequisites

- This plugin requires the following packages to be installed:
  - [@aws-sdk/rds-signer](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-rds-signer/)
  - [@smithy/types](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-smithy-types/)
  - [@aws-sdk/credential-providers](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-credential-providers/)

## How do I use IAM with the AWS Advanced NodeJS Wrapper?

1. Enable AWS IAM database authentication on an existing database or create a new database with AWS IAM database authentication on the AWS RDS Console:
   1. If needed, review the documentation about [creating a new database](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html).
   2. If needed, review the documentation about [modifying an existing database](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.DBInstance.Modifying.html).
2. Set up an [AWS IAM policy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.IAMPolicy.html) for AWS IAM database authentication.
3. [Create a database account](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html) using AWS IAM database authentication. This will be the user specified in the connection parameters.
   1. Connect to your database of choice using primary logins.
      1. For a MySQL database, use the following command to create a new user:<br>
         `CREATE USER example_user_name IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';`
      2. For a PostgreSQL database, use the following command to create a new user:<br>
         `CREATE USER db_userx; GRANT rds_iam TO db_userx;`
4. Add the plugin code `iam` to the [`plugins`](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) connection parameter.

| Parameter            | Value    |                 Required                  | Description                                                                                                                                                                                                                                | Default Value                                    | Example Value                                       |
|:---------------------|:---------|:-----------------------------------------:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------------------------------------------------|:----------------------------------------------------|
| `iamDefaultPort`     | `String` |                    No                     | This property will override the default port that is used to generate the IAM token. The default port is determined based on the underlying database.                                                                                      | `null`                                           | `1234`                                              |
| `iamHost`            | `String` | Only required when using custom endpoints | This property will override the default hostname that is used to generate the IAM token.                                                                                                                                                   | The host value from the connection configuration | `database.cluster-hash.us-east-1.rds.amazonaws.com` |
| `iamRegion`          | `String` |                    No                     | This property will override the default region that is used to generate the IAM token. If the property is not set, the wrapper will attempt to parse the region from the host provided in the configuration parameters.                    | `null`                                           | `us-east-2`                                         |
| `iamTokenExpiration` | `Number` |                    No                     | This property determines how long an IAM token is kept in the driver cache before a new one is generated. The default expiration time is set to be 15 minutes. Note that IAM database authentication tokens have a lifetime of 15 minutes. | `900`                                            | `600`                                               |

## Sample code

[IAM Authentication Plugin example for PostgreSQL](../../../examples/aws_driver_example/aws_iam_authentication_postgresql_example.ts)<br>
[IAM Authentication Plugin example for MySQL](../../../examples/aws_driver_example/aws_iam_authentication_mysql_example.ts)
