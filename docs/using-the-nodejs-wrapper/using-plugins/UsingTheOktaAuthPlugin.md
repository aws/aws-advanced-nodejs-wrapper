# Okta Authentication Plugin

The Okta Authentication Plugin adds support for authentication via Federated Identity and then database access via IAM.

## Prerequisites

- This plugin requires the following packages to be installed:
  - [@aws-sdk/rds-signer](https://www.npmjs.com/package/@aws-sdk/rds-signer)
  - [aws-sdk](https://www.npmjs.com/package/aws-sdk)
  - [axios](https://www.npmjs.com/package/axios)
  - [entities](https://www.npmjs.com/package/entities)

## What is Federated Identity

Federated Identity allows users to use the same set of credentials to access multiple services or resources across different organizations. This works by having Identity Providers (IdP) that manage and authenticate user credentials, and Service Providers (SP) that are services or resources that can be internal, external, and/or belonging to various organizations. Multiple SPs can establish trust relationships with a single IdP.

When a user wants access to a resource, it authenticates with the IdP. From this, a security token generated and is passed to the SP then grants access to said resource.
In the case of AD FS, the user signs into the AD FS sign in page. This generates a SAML Assertion which acts as a security token. The user then passes the SAML Assertion to the SP when requesting access to resources. The SP verifies the SAML Assertion and grants access to the user.

## How to use the Okta Authentication Plugin with the AWS Advanced NodeJS Wrapper

### Enabling the Okta Authentication Plugin

> [!NOTE]\
> AWS IAM database authentication is needed to use the Okta Authentication Plugin. This is because after the plugin
> acquires SAML assertion from the identity provider, the SAML Assertion is then used to acquire an AWS IAM token. The AWS
> IAM token is then subsequently used to access the database.

1. Enable AWS IAM database authentication on an existing database or create a new database with AWS IAM database authentication on the AWS RDS Console:
   - If needed, review the documentation about [IAM authentication for MariaDB, MySQL, and PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html).
2. Configure Okta as the AWS identity provider.
   - If needed, review the documentation about [Amazon Web Services Account Federation](https://help.okta.com/en-us/content/topics/deploymentguides/aws/aws-deployment.htm) on Okta's documentation.
3. Add the plugin code `okta` to the [`plugins`](../UsingTheNodejsWrapper.md#connection-plugin-manager-parameters) connection parameter.
4. Specify parameters that are required or specific to your case.

### Okta Authentication Plugin Parameters

| Parameter            |  Value   | Required | Description                                                                                                                                                                                                                                                                                                                                                        | Default Value | Example Value                                          |
| -------------------- | :------: | :------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------ | :----------------------------------------------------- |
| `dbUser`             | `String` |   Yes    | The user name of the IAM user with access to your database. <br>If you have previously used the IAM Authentication Plugin, this would be the same IAM user. <br>For information on how to connect to your Aurora Database with IAM, see this [documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.Connecting.html). | `null`        | `some_username`                                        |
| `idpUsername`        | `String` |   Yes    | The user name for the `idpEndpoint` server. If this parameter is not specified, the plugin will fallback to using the `user` parameter.                                                                                                                                                                                                                            | `null`        | `jimbob@example.com`                                   |
| `idpPassword`        | `String` |   Yes    | The password associated with the `idpEndpoint` username. If this parameter is not specified, the plugin will fallback to using the `password` parameter.                                                                                                                                                                                                           | `null`        | `someRandomPassword`                                   |
| `idpEndpoint`        | `String` |   Yes    | The hosting URL for the service that you are using to authenticate into AWS Aurora.                                                                                                                                                                                                                                                                                | `null`        | `ec2amaz-ab3cdef.example.com`                          |
| `appId`              | `String` |   Yes    | The Amazon Web Services (AWS) app [configured](https://help.okta.com/en-us/content/topics/deploymentguides/aws/aws-configure-aws-app.htm) on Okta.                                                                                                                                                                                                                 | `null`        | `abcde1f2345G43fqk5d7`                                 |
| `iamRoleArn`         | `String` |   Yes    | The ARN of the IAM Role that is to be assumed to access AWS Aurora.                                                                                                                                                                                                                                                                                                | `null`        | `arn:aws:iam::123456789012:role/adfs_example_iam_role` |
| `iamIdpArn`          | `String` |   Yes    | The ARN of the Identity Provider.                                                                                                                                                                                                                                                                                                                                  | `null`        | `arn:aws:iam::123456789012:saml-provider/adfs_example` |
| `iamRegion`          | `String` |   Yes    | The IAM region where the IAM token is generated.                                                                                                                                                                                                                                                                                                                   | `null`        | `us-east-2`                                            |
| `iamHost`            | `String` |    No    | Overrides the host that is used to generate the IAM token.                                                                                                                                                                                                                                                                                                         | `null`        | `database.cluster-hash.us-east-1.rds.amazonaws.com`    |
| `iamDefaultPort`     | `Number` |    No    | This property overrides the default port that is used to generate the IAM token. The default port is determined based on the underlying driver protocol. Target drivers with different protocols will require users to provide a default port.                                                                                                                     | `null`        | `1234`                                                 |
| `iamTokenExpiration` | `Number` |    No    | Overrides the default IAM token cache expiration in seconds.                                                                                                                                                                                                                                                                                                       | `900`         | `123`                                                  |
| `httpsAgentOptions`  | `Object` |    No    | This property adds parameters to the httpsAgent that connects to the hosting URL. <br>For more information on the parameters, see this [documentation](https://nodejs.org/api/https.html#new-agentoptions).                                                                                                                                                        | `null`        | `{ timeout: 5000 }`                                    |
