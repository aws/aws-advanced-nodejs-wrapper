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

import { ConnectionPluginFactory } from "../../plugin_factory";
import { PluginService } from "../../plugin_service";
import { ConnectionPlugin } from "../../connection_plugin";
import { logger } from "../../../logutils";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";

export class OktaAuthPluginFactory extends ConnectionPluginFactory {
  private static oktaAuthPlugin: any;
  private static oktaCredentialsProviderFactory: any;

  async getInstance(pluginService: PluginService, properties: Map<string, any>): Promise<ConnectionPlugin> {
    try {
      if (!OktaAuthPluginFactory.oktaAuthPlugin) {
        OktaAuthPluginFactory.oktaAuthPlugin = await import("./okta_auth_plugin");
      }
      if (!OktaAuthPluginFactory.oktaCredentialsProviderFactory) {
        OktaAuthPluginFactory.oktaCredentialsProviderFactory = await import("./okta_credentials_provider_factory");
      }

      const oktaCredentialsProviderFactory = new OktaAuthPluginFactory.oktaCredentialsProviderFactory.OktaCredentialsProviderFactory(pluginService);
      return new OktaAuthPluginFactory.oktaAuthPlugin.OktaAuthPlugin(pluginService, oktaCredentialsProviderFactory);
    } catch (error: any) {
      logger.error(error);
      throw new AwsWrapperError(Messages.get("ConnectionPluginChainBuilder.errorImportingPlugin", "OktaAuthPlugin"));
    }
  }
}
