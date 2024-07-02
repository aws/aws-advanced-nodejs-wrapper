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

import { AbstractConnectionPlugin } from "../../abstract_connection_plugin";
import { HostInfo } from "../../host_info";
import { SamlUtils } from "../../utils/saml_utils";
import { IamAuthUtils, TokenInfo } from "../../utils/iam_auth_utils";
import { PluginService } from "../../plugin_service";
import { CredentialsProviderFactory } from "./credentials_provider_factory";
import { RdsUtils } from "../../utils/rds_utils";
import { WrapperProperties } from "../../wrapper_property";
import { logger } from "../../../logutils";
import { Messages } from "../../utils/messages";
import { AwsWrapperError } from "../../utils/errors";

export class OktaAuthPlugin extends AbstractConnectionPlugin {
  protected static readonly tokenCache = new Map<string, TokenInfo>();
  private static readonly subscribedMethods = new Set<string>(["connect", "forceConnect"]);
  protected pluginService: PluginService;
  protected rdsUtils = new RdsUtils();
  private readonly credentialsProviderFactory: CredentialsProviderFactory;

  constructor(pluginService: PluginService, credentialsProviderFactory: CredentialsProviderFactory) {
    super();
    this.pluginService = pluginService;
    this.credentialsProviderFactory = credentialsProviderFactory;
  }

  public getSubscribedMethods(): Set<string> {
    return OktaAuthPlugin.subscribedMethods;
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, connectFunc);
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, connectFunc);
  }

  async connectInternal<T>(hostInfo: HostInfo, props: Map<string, any>, connectFunc: () => Promise<T>): Promise<T> {
    SamlUtils.checkIdpCredentialsWithFallback(props);

    const host = IamAuthUtils.getIamHost(props, hostInfo);
    const port = IamAuthUtils.getIamPort(props, hostInfo, this.pluginService.getDialect().getDefaultPort());
    const region = IamAuthUtils.getRdsRegion(host, this.rdsUtils, props);

    const cacheKey = IamAuthUtils.getCacheKey(port, WrapperProperties.DB_USER.get(props), host, region);
    const tokenInfo = OktaAuthPlugin.tokenCache.get(cacheKey);

    const isCachedToken = tokenInfo !== undefined && !tokenInfo.isExpired();

    if (isCachedToken) {
      logger.debug(Messages.get("AuthenticationToken.useCachedToken", tokenInfo.token));
      WrapperProperties.PASSWORD.set(props, tokenInfo.token);
    } else {
      await this.updateAuthenticationToken(hostInfo, props, region, cacheKey);
    }
    WrapperProperties.USER.set(props, WrapperProperties.DB_USER.get(props));
    this.pluginService.updateConfigWithProperties(props);

    try {
      return await connectFunc();
    } catch (e: any) {
      if (!this.pluginService.isLoginError(e as Error) || !isCachedToken) {
        logger.debug(Messages.get("Authentication.connectException", e.message));
        throw e;
      }
      try {
        await this.updateAuthenticationToken(hostInfo, props, region, cacheKey);
        return await connectFunc();
      } catch (e: any) {
        throw new AwsWrapperError(Messages.get("SamlAuthPlugin.unhandledException", e.message));
      }
    }
  }

  public async updateAuthenticationToken(hostInfo: HostInfo, props: Map<string, any>, region: string, cacheKey: string): Promise<void> {
    const tokenExpirationSec = WrapperProperties.IAM_TOKEN_EXPIRATION.get(props);
    const tokenExpiry = Date.now() + tokenExpirationSec * 1000;
    const port = IamAuthUtils.getIamPort(props, hostInfo, this.pluginService.getDialect().getDefaultPort());
    const token = await IamAuthUtils.generateAuthenticationToken(
      hostInfo.host,
      port,
      region,
      WrapperProperties.DB_USER.get(props),
      await this.credentialsProviderFactory.getAwsCredentialsProvider(hostInfo.host, region, props)
    );
    logger.debug(Messages.get("AuthenticationToken.useCachedToken", token));
    WrapperProperties.PASSWORD.set(props, token);
    OktaAuthPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
  }

  public static clearCache(): void {
    OktaAuthPlugin.tokenCache.clear();
  }
}
