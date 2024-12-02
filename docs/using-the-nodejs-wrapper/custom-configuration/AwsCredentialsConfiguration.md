# AWS Credentials Provider Configuration

### Applicable plugins: AWS IAM Authentication Plugin, AWS Secrets Manager Plugin

The [AWS IAM Authentication Plugin](../using-plugins/UsingTheIamAuthenticationPlugin.md) and [AWS Secrets Manager Plugin](../using-plugins/UsingTheAwsSecretsManagerPlugin.md) both require authentication via AWS credentials to provide the functionality they offer. In the plugin logic, the mechanism to locate your credentials is defined by passing in an `AwsCredentialsProvider` object to the applicable AWS SDK client. By default, an instance of `DefaultCredentialsProvider` will be passed, which locates your credentials using the default credential provider chain described [in this doc](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-credential-providers/). If AWS credentials are provided by the `credentials` and `config` files ([Default credentials provider chain](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-credential-providers/#fromini)), then it's possible to specify a profile name using the `awsProfile` configuration parameter. If no profile name is specified, a `[default]` profile is used.

If you would like to define your own mechanism for providing AWS credentials, you can do so using `customAwsCredentialProviderHandler` parameter for a new connection and passing an object that implements `AwsCredentialsProviderHandler`. See below for an example:

```typescript
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

class MyCustomAwsCredentialProvider implements AwsCredentialsProviderHandler {
  getAwsCredentialsProvider(hostInfo: HostInfo, properties: Map<string, any>): AwsCredentialIdentityProvider {
    // Initialize AWS Credential Provider here and return it.
    // The following code is just an example.
    return fromNodeProviderChain();
  }
}
myProvider: MyCustomAwsCredentialProvider = new MyCustomAwsCredentialProvider();

const client = new AwsPGClient({
  ...
  customAwsCredentialProviderHandler: myProvider
  ...
});

```
