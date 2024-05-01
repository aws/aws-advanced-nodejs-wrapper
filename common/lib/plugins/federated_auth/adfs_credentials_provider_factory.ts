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
import { AwsWrapperError } from "../../utils/errors";
import { WrapperProperties } from "../../wrapper_property";
import { FederatedAuthPlugin } from "./federated_auth_plugin";
import { SamlCredentialsProviderFactory } from "./saml_credentials_provider_factory";

export class AdfsCredentialsProviderFactory extends SamlCredentialsProviderFactory {
  static readonly IDP_NAME = "adfs";
  private static readonly TELEMETRY_FETCH_SAML = "Fetch ADFS SAML Assertion";
  private static readonly INPUT_TAG_PATTERN = new RegExp("<input(.+?)/>");
  private static readonly FORM_ACTION_PATTERN = new RegExp('<form.*?action="([^"]+)"');
  private pluginService: PluginService;

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;
  }

  getSamlAssertion(props: Map<string, any>): string {
    // let uri = this.getSignInPageUrl(props); TODO
  }

  getSignInPageUrl(props: Map<string, any>): string {
    const idpEndpoint = WrapperProperties.IDP_ENDPOINT.get(props);
    const idpPort = WrapperProperties.IDP_PORT.get(props);
    const rpId = WrapperProperties.RELAYING_PARTY_ID.get(props);
    if (!idpPort || !rpId) {
      throw new AwsWrapperError("Invalid Https url");
    }
    return `https://${idpEndpoint}:${idpPort}/adfs/ls/IdpInitiatedSignOn.aspx?loginToRp=${rpId}`;
  }

  getFormActionUrl(props: Map<string, any>, action: string) {
    const idpEndpoint = WrapperProperties.IDP_ENDPOINT.get(props);
    const idpPort = WrapperProperties.IDP_PORT.get(props);
    if (!idpEndpoint) {
      throw new AwsWrapperError("Invalid Https url");
    }
    return `https://${idpEndpoint}:${idpPort}${action}`;
  }

  private getInputTagsFromHtml(body: string): Array<string> {
    const distinctInputTags = new Set<string>();
    const inputTags = [];
    const results = AdfsCredentialsProviderFactory.INPUT_TAG_PATTERN.exec(body); //TODO dotall
    if (results === null) {
      throw new AwsWrapperError("Input tags not found");
    }
    for (const tag of results) {
      const tagNameLower = this.getValueByKey(tag, "name").toLowerCase();
      if (!(tagNameLower.length === 0) && !distinctInputTags.has(tagNameLower)) {
        distinctInputTags.add(tagNameLower);
        inputTags.push(tag);
      }
    }
    return inputTags;
  }

  private getParametersFromHtmlBody(body: string, props: Map<string, any>): Record<string, string> {
    const parameters: { [key: string]: string } = {};
    for (const inputTag of this.getInputTagsFromHtml(body)) {
      const name = this.getValueByKey(inputTag, "name");
      const value = this.getValueByKey(inputTag, "value");
      const nameLower = name.toLowerCase();

      if (nameLower.includes("username")) {
        parameters[name] = WrapperProperties.IDP_USERNAME.get(props);
      } else if (nameLower.includes("authmethod")) {
        if (!(value.length === 0)) {
          parameters[name] = value;
        }
      } else if (nameLower.includes("password")) {
        parameters[name] = WrapperProperties.IDP_PASSWORD.get(props);
      } else if (!(name.length === 0)) {
        parameters[name] = value;
      }
    }
    return parameters;
  }

  private getValueByKey(input: string, key: string): string {
    const keyValuePattern = new RegExp("(" + this.escapeRegExp(key) + ')\\s*=\\s*"(.*?)"');
    const match = input.match(keyValuePattern);
    if (match) {
      return this.escapeHtmlEntity(match[2]);
    }
    return "";
  }

  private escapeRegExp(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private escapeHtmlEntity(html: string | undefined): string {
    if (!html) {
      throw new AwsWrapperError("Empty html");
    }
    let str = "";
    let i = 0;
    const len = html.length;
    while (i < len) {
      const c = html.at(i);
      if (c !== "&") {
        str += c;
        i++;
        continue;
      }
      if (html.startsWith("&amp;", i)) {
        str += "&";
        i += 5;
      } else if (html.startsWith("&apos;", i)) {
        str += "'";
        i += 6;
      } else if (html.startsWith("&quot;", i)) {
        str += '"';
        i += 6;
      } else if (html.startsWith("&lt;", i)) {
        str += "<";
        i += 4;
      } else if (html.startsWith("&gt;", i)) {
        str += ">";
        i += 4;
      } else {
        str += c;
        ++i;
      }
    }
    return str;
  }

  getFormActionHtmlBody(body: string): string | null {
    if (AdfsCredentialsProviderFactory.FORM_ACTION_PATTERN.test(body)) {
      return this.escapeHtmlEntity(AdfsCredentialsProviderFactory.FORM_ACTION_PATTERN.exec(body)?.[0]);
    }
    return null;
  }

  private validateUrl(url: string): void {}
}
