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
import { ConnectionPlugin } from "../../connection_plugin";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { FullServicesContainer } from "../../utils/full_services_container";

export class StaleDnsPluginFactory extends ConnectionPluginFactory {
  private static staleDnsPlugin: any;

  async getInstance(servicesContainer: FullServicesContainer, properties: Map<string, any>): Promise<ConnectionPlugin> {
    try {
      if (!StaleDnsPluginFactory.staleDnsPlugin) {
        StaleDnsPluginFactory.staleDnsPlugin = await import("./stale_dns_plugin");
      }
      return new StaleDnsPluginFactory.staleDnsPlugin.StaleDnsPlugin(servicesContainer.getPluginService(), properties);
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("ConnectionPluginChainBuilder.errorImportingPlugin", error.message, "StaleDnsPlugin"));
    }
  }
}
