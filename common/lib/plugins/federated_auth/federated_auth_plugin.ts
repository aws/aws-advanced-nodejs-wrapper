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

import { PluginService } from "../../plugin_service";
import { CredentialsProviderFactory } from "./credentials_provider_factory";
import { BaseSamlAuthPlugin } from "./saml_auth_plugin";
import { IamAuthUtils } from "../../utils/iam_auth_utils";

export class FederatedAuthPlugin extends BaseSamlAuthPlugin {
  constructor(pluginService: PluginService, credentialsProviderFactory: CredentialsProviderFactory, iamAuthUtils: IamAuthUtils = new IamAuthUtils()) {
    super(pluginService, credentialsProviderFactory, "federatedAuth.fetchToken.count", iamAuthUtils);
  }
}
