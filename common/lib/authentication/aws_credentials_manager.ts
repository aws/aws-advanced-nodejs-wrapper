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

import { HostInfo } from "../host_info";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { AwsCredentialIdentityProvider } from "@smithy/types/dist-types/identity/awsCredentialIdentity";
import { WrapperProperties } from "../wrapper_property";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";

interface AwsCredentialsProviderHandler {
  getAwsCredentialsProvider(hostInfo: HostInfo, properties: Map<string, any>): AwsCredentialIdentityProvider;
}

export class AwsCredentialsManager {
  static getProvider(hostInfo: HostInfo, props: Map<string, any>): AwsCredentialIdentityProvider {
    const awsCredentialProviderHandler = WrapperProperties.CUSTOM_AWS_CREDENTIAL_PROVIDER_HANDLER.get(props);
    if (awsCredentialProviderHandler && !AwsCredentialsManager.isAwsCredentialsProviderHandler(awsCredentialProviderHandler)) {
      throw new AwsWrapperError(Messages.get("AwsCredentialsManager.wrongHandler"));
    }

    return !awsCredentialProviderHandler
      ? AwsCredentialsManager.getDefaultProvider(WrapperProperties.AWS_PROFILE.get(props))
      : awsCredentialProviderHandler.getAwsCredentialsProvider(hostInfo, props);
  }

  private static getDefaultProvider(profileName: string | null) {
    if (profileName) {
      return fromNodeProviderChain({ profile: profileName });
    }
    return fromNodeProviderChain();
  }

  private static isAwsCredentialsProviderHandler(arg: any): arg is AwsCredentialsProviderHandler {
    return arg.getAwsCredentialsProvider !== undefined;
  }
}
