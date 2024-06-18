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

import { SamlCredentialsProviderFactory } from "./saml_credentials_provider_factory";
import { WrapperProperties } from "../../wrapper_property";
import { SamlUtils } from "../../utils/saml_utils";
import axios from "axios";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { HttpsCookieAgent } from "http-cookie-agent/http";
import { AwsWrapperError } from "../../utils/errors";

export class OktaCredentialsProviderFactory extends SamlCredentialsProviderFactory {
  private static readonly OKTA_AWS_APP_NAME = "amazon_aws";
  private static readonly SESSION_TOKEN = "sessionToken";
  private static readonly SAML_RESPONSE_PATTERN = new RegExp('SAMLResponse(?:.|\\n)*value="(?<saml>[^"]+)"');

  constructor() {
    super();
  }

  getSamlUrl(props: Map<string, any>) {
    const idpHost = WrapperProperties.IDP_ENDPOINT.get(props);
    const appId = WrapperProperties.APP_ID.get(props);
    const baseUri = `https://${idpHost}/app/${OktaCredentialsProviderFactory.OKTA_AWS_APP_NAME}/${appId}/sso/saml`;
    SamlUtils.validateUrl(baseUri);
    return baseUri;
  }

  async getSessionToken(props: Map<string, any>): Promise<string> {
    const idpHost = WrapperProperties.IDP_ENDPOINT.get(props);
    const idpUser = WrapperProperties.IDP_USERNAME.get(props);
    const idpPassword = WrapperProperties.IDP_PASSWORD.get(props);

    const httpsAgent = new HttpsCookieAgent(WrapperProperties.HTTPS_AGENT_OPTIONS.get(props));

    const sessionTokenEndpoint = `https://${idpHost}/api/v1/authn`;

    const data = JSON.stringify({
      username: idpUser,
      password: idpPassword
    });

    const postConfig = {
      method: "post",
      maxBodyLength: Infinity,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      url: sessionTokenEndpoint,
      httpsAgent,
      data,
      withCredentials: true
    };

    try {
      const resp = await axios.request(postConfig);
      if (!resp.data[OktaCredentialsProviderFactory.SESSION_TOKEN]) {
        throw new AwsWrapperError(Messages.get("OktaCredentialsProviderFactory.invalidSessionToken"));
      }
      return resp.data[OktaCredentialsProviderFactory.SESSION_TOKEN];
    } catch (e: any) {
      if (!e.response) {
        throw e;
      }
      throw new AwsWrapperError(Messages.get("OktaCredentialsProviderFactory.sessionTokenRequestFailed"));
    }
  }

  async getSamlAssertion(props: Map<string, any>): Promise<string> {
    const oneTimeToken = await this.getSessionToken(props);
    const uri = this.getSamlUrl(props);
    SamlUtils.validateUrl(uri);

    logger.debug(Messages.get("OktaCredentialsProviderFactory.samlAssertionUrl", uri));

    const httpsAgent = new HttpsCookieAgent(WrapperProperties.HTTPS_AGENT_OPTIONS.get(props));
    const getConfig = {
      method: "get",
      maxBodyLength: Infinity,
      url: uri,
      httpsAgent,
      params: {
        onetimetoken: oneTimeToken
      },
      withCredentials: true
    };

    try {
      const resp = await axios.request(getConfig);
      const data: string = resp.data;
      const match = data.match(OktaCredentialsProviderFactory.SAML_RESPONSE_PATTERN);
      if (!match) {
        throw new AwsWrapperError(Messages.get("OktaCredentialsProviderFactory.invalidSamlResponse"));
      }
      return match[1];
    } catch (e: any) {
      if (!e.response) {
        throw e;
      }
      if (e.response.status / 100 != 2) {
        throw new AwsWrapperError(
          Messages.get("OktaCredentialsProviderFactory.samlRequestFailed", e.response.status, e.response.statusText, e.message)
        );
      }
      throw new AwsWrapperError(Messages.get("SAMLCredentialsProviderFactory.getSamlAssertionFailed", e.message));
    }
  }
}
