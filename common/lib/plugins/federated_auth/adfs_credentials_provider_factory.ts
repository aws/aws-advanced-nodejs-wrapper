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

import { logger } from "../../../logutils";
import { PluginService } from "../../plugin_service";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { WrapperProperties } from "../../wrapper_property";
import { SamlCredentialsProviderFactory } from "./saml_credentials_provider_factory";
import https from "https";
import axios from "axios";
import { stringify } from "querystring";
import tough from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import { HttpsCookieAgent } from "http-cookie-agent/http";

export class AdfsCredentialsProviderFactory extends SamlCredentialsProviderFactory {
  static readonly IDP_NAME = "adfs";
  private static readonly INPUT_TAG_PATTERN = new RegExp("<input(.+?)/>", "gms");
  private static readonly FORM_ACTION_PATTERN = new RegExp('<form.*?action="([^"]+)"');
  private static readonly SAML_RESPONSE_PATTERN = new RegExp('SAMLResponse\\W+value="(?<saml>[^"]+)"');
  private static readonly HTTPS_URL_PATTERN = new RegExp("^(https)://[-a-zA-Z0-9+&@#/%?=~_!:,.']*[-a-zA-Z0-9+&@#/%=~_']");
  private pluginService: PluginService;

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;
  }

  async getSamlAssertion(props: Map<string, any>): Promise<string> {
    try {
      let uri = this.getSignInPageUrl(props);
      const signInPageBody: string = await this.getSignInPageBody(uri, props);
      const action = this.getFormActionHtmlBody(signInPageBody);
      if (action && action.startsWith("/")) {
        uri = this.getFormActionUrl(props, action);
      }
      const params = this.getParametersFromHtmlBody(signInPageBody, props);
      const content = await this.getFormActionBody(uri, params, props);

      const match = content.match(AdfsCredentialsProviderFactory.SAML_RESPONSE_PATTERN);
      if (!match) {
        throw new AwsWrapperError(Messages.get("AdfsCredentialsProviderFactory.failedLogin", content));
      }
      return match[1];
    } catch (e) {
      throw new AwsWrapperError(Messages.get("AdfsCredentialsProviderFactory.getSamlAssertionFailed", (e as Error).message));
    }
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

  async getSignInPageBody(url: string, props: Map<string, any>): Promise<string> {
    logger.debug(Messages.get("AdfsCredentialsProviderFactory.signOnPageUrl", url));
    this.validateUrl(url);
    const httpsAgent = new https.Agent(WrapperProperties.HTTPS_AGENT_OPTIONS.get(props));
    const getConfig = {
      method: "get",
      maxBodyLength: Infinity,
      url,
      httpsAgent,
      withCredentials: true
    };

    try {
      const resp = await axios.request(getConfig);
      return resp.data;
    } catch (e: any) {
      if (!e.response) {
        throw e;
      }
      throw new AwsWrapperError(
        Messages.get("AdfsCredentialsProviderFactory.signOnPageRequestFailed", e.response.status, e.response.statusText, e.message)
      );
    }
  }

  async getFormActionBody(uri: string, parameters: Record<string, string>, props: Map<string, any>): Promise<string> {
    logger.debug(Messages.get("AdfsCredentialsProviderFactory.signOnPageUrl", uri));
    this.validateUrl(uri);
    wrapper(axios);
    const jar = new tough.CookieJar();
    const httpsAgentOptions = { ...WrapperProperties.HTTPS_AGENT_OPTIONS.get(props), ...{ cookies: { jar } } };
    const httpsAgent = new HttpsCookieAgent(httpsAgentOptions);

    let cookies;

    const data = stringify(parameters);

    const postConfig = {
      method: "post",
      maxBodyLength: Infinity,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      url: uri,
      httpsAgent,
      maxRedirects: 0,
      data,
      withCredentials: true
    };

    let getResp;

    try {
      // First post which results in redirect
      const postResp = await axios.request(postConfig);
      // Store cookies from post
      cookies = postResp.headers["set-cookie"];
      console.log(JSON.stringify(postResp.data));
    } catch (e: any) {
      if (!e.response) {
        throw e;
      }
      // After redirect, try get request, fail if not redirect
      if (Math.floor(e.response.status / 100) !== 3) {
        throw new AwsWrapperError(
          Messages.get("AdfsCredentialsProviderFactory.signOnPagePostActionRequestFailed", e.response.status, e.response.statusText, e.message)
        );
      }
      cookies = e.response.headers["set-cookie"];
      const url = e.response.headers.location;
      const redirectConfig = {
        maxBodyLength: Infinity,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
          // Cookie: cookies
        },
        httpsAgent,
        withCredentials: true
      };
      getResp = await axios.get(url, redirectConfig);
      return getResp.data;
    }
    return "";
  }

  getFormActionUrl(props: Map<string, any>, action: string): string {
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
    const tags = body.matchAll(AdfsCredentialsProviderFactory.INPUT_TAG_PATTERN);
    if (tags) {
      for (const tag of tags) {
        const tagNameLower = this.getValueByKey(tag[0], "name").toLowerCase();
        if (!(tagNameLower.length === 0) && !distinctInputTags.has(tagNameLower)) {
          distinctInputTags.add(tagNameLower);
          inputTags.push(tag[0]);
        }
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

  private escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private escapeHtmlEntity(html?: string): string {
    let ret = "";
    let i = 0;
    if (html) {
      const len = html.length;
      while (i < len) {
        const c = html.at(i);
        if (c !== "&") {
          ret += c;
          i++;
          continue;
        }
        if (html.startsWith("&amp;", i)) {
          ret += "&";
          i += 5;
        } else if (html.startsWith("&apos;", i)) {
          ret += "'";
          i += 6;
        } else if (html.startsWith("&quot;", i)) {
          ret += '"';
          i += 6;
        } else if (html.startsWith("&lt;", i)) {
          ret += "<";
          i += 4;
        } else if (html.startsWith("&gt;", i)) {
          ret += ">";
          i += 4;
        } else {
          ret += c;
          ++i;
        }
      }
    }
    return ret;
  }

  getFormActionHtmlBody(body: string): string | null {
    if (AdfsCredentialsProviderFactory.FORM_ACTION_PATTERN.test(body)) {
      const match = body.match(AdfsCredentialsProviderFactory.FORM_ACTION_PATTERN);
      if (match) {
        return this.escapeHtmlEntity(match[1]);
      }
    }
    return null;
  }

  private validateUrl(url: string): void {
    try {
      new URL(url);
      if (!url.match(AdfsCredentialsProviderFactory.HTTPS_URL_PATTERN)) {
        throw new AwsWrapperError(Messages.get("AdfsCredentialsProviderFactory.invalidHttpsUrl", url));
      }
    } catch (e) {
      throw new AwsWrapperError(Messages.get("AdfsCredentialsProviderFactory.invalidHttpsUrl", url));
    }
  }
}
