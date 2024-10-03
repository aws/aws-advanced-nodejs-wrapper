/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { CredentialsProviderFactory } from "./credentials_provider_factory";
import { AssumeRoleWithSAMLCommand, STSClient } from "@aws-sdk/client-sts";
import { WrapperProperties } from "../../wrapper_property";
import { Credentials } from "aws-sdk";
import { AwsWrapperError } from "../../utils/errors";
import { AwsCredentialIdentityProvider, AwsCredentialIdentity } from "@smithy/types/dist-types/identity/awsCredentialIdentity";
import { decode } from "entities";

export abstract class SamlCredentialsProviderFactory implements CredentialsProviderFactory {
  async getAwsCredentialsProvider(
    host: string,
    region: string,
    props: Map<string, any>
  ): Promise<AwsCredentialIdentity | AwsCredentialIdentityProvider> {
    const samlAssertion = await this.getSamlAssertion(props);
    const assumeRoleWithSamlRequest = new AssumeRoleWithSAMLCommand({
      SAMLAssertion: decode(samlAssertion),
      RoleArn: WrapperProperties.IAM_ROLE_ARN.get(props),
      PrincipalArn: WrapperProperties.IAM_IDP_ARN.get(props)
    });

    const stsClient = new STSClient({
      region: region
    });

    const results = await stsClient.send(assumeRoleWithSamlRequest);
    const credentials = results["Credentials"];

    if (credentials && credentials.AccessKeyId && credentials.SecretAccessKey && credentials.SessionToken) {
      return new Credentials({
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken
      });
    }
    throw new AwsWrapperError("Credentials from SAML request not found");
  }

  abstract getSamlAssertion(props: Map<string, any>): Promise<string>;

  formatIdpEndpoint(idpEndpoint: string): string{
    // Only add "https://" if user has passed their idpEndpoint without the URL scheme. 
    if (!idpEndpoint.startsWith("https://")) {
      return `https://${idpEndpoint}`;
    }
    return idpEndpoint;
      }
}
