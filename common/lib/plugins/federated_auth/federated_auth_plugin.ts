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
import { PluginService } from "../../plugin_service";
import { RdsUtils } from "../../utils/rds_utils";
import { HostInfo } from "../../host_info";
import { IamAuthUtils, TokenInfo } from "../../utils/iam_auth_utils";
import { WrapperProperties } from "../../wrapper_property";
import { logger } from "../../../logutils";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { CredentialsProviderFactory } from "./credentials_provider_factory";
import { SamlUtils } from "../../utils/saml_utils";
import { ClientWrapper } from "../../client_wrapper";
import { TelemetryCounter } from "../../utils/telemetry/telemetry_counter";
import { RegionUtils } from "../../utils/region_utils";

export class FederatedAuthPlugin extends AbstractConnectionPlugin {
  protected static readonly tokenCache = new Map<string, TokenInfo>();
  protected rdsUtils: RdsUtils = new RdsUtils();
  protected pluginService: PluginService;
  private static readonly subscribedMethods = new Set<string>(["connect", "forceConnect"]);
  private readonly credentialsProviderFactory: CredentialsProviderFactory;
  private readonly fetchTokenCounter: TelemetryCounter;

  public getSubscribedMethods(): Set<string> {
    return FederatedAuthPlugin.subscribedMethods;
  }

  constructor(pluginService: PluginService, credentialsProviderFactory: CredentialsProviderFactory) {
    super();
    this.credentialsProviderFactory = credentialsProviderFactory;
    this.pluginService = pluginService;
    this.fetchTokenCounter = this.pluginService.getTelemetryFactory().createCounter("federatedAuth.fetchToken.count");
  }

  connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(hostInfo, props, connectFunc);
  }

  forceConnect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(hostInfo, props, forceConnectFunc);
  }

  async connectInternal(hostInfo: HostInfo, props: Map<string, any>, connectFunc: () => Promise<ClientWrapper>): Promise<ClientWrapper> {
    SamlUtils.checkIdpCredentialsWithFallback(props);

    const host = IamAuthUtils.getIamHost(props, hostInfo);
    const port = IamAuthUtils.getIamPort(props, hostInfo, this.pluginService.getDialect().getDefaultPort());
    const region: string = RegionUtils.getRegion(props.get(WrapperProperties.IAM_REGION.name), host);

    const cacheKey = IamAuthUtils.getCacheKey(port, WrapperProperties.DB_USER.get(props), host, region);
    const tokenInfo = FederatedAuthPlugin.tokenCache.get(cacheKey);

    const isCachedToken: boolean = tokenInfo !== undefined && !tokenInfo.isExpired();

    if (isCachedToken && tokenInfo) {
      logger.debug(Messages.get("AuthenticationToken.useCachedToken", tokenInfo.token));
      WrapperProperties.PASSWORD.set(props, tokenInfo.token);
    } else {
      await this.updateAuthenticationToken(hostInfo, props, region, cacheKey, host);
    }
    WrapperProperties.USER.set(props, WrapperProperties.DB_USER.get(props));
    this.pluginService.updateConfigWithProperties(props);

    try {
      return await connectFunc();
    } catch (e) {
      if (!this.pluginService.isLoginError(e as Error) || !isCachedToken) {
        throw e;
      }
      try {
        await this.updateAuthenticationToken(hostInfo, props, region, cacheKey, host);
        return await connectFunc();
      } catch (e: any) {
        throw new AwsWrapperError(Messages.get("SamlAuthPlugin.unhandledError", e.message));
      }
    }
  }

  public async updateAuthenticationToken(hostInfo: HostInfo, props: Map<string, any>, region: string, cacheKey: string, iamHost: string) {
    const tokenExpirationSec = WrapperProperties.IAM_TOKEN_EXPIRATION.get(props);
    if (tokenExpirationSec < 0) {
      throw new AwsWrapperError(Messages.get("AuthenticationToken.tokenExpirationLessThanZero"));
    }
    const tokenExpiry: number = Date.now() + tokenExpirationSec * 1000;
    const port = IamAuthUtils.getIamPort(props, hostInfo, this.pluginService.getDialect().getDefaultPort());
    const token = await IamAuthUtils.generateAuthenticationToken(
      iamHost,
      port,
      region,
      WrapperProperties.DB_USER.get(props),
      await this.credentialsProviderFactory.getAwsCredentialsProvider(hostInfo.host, region, props),
      this.pluginService
    );
    this.fetchTokenCounter.inc();
    logger.debug(Messages.get("AuthenticationToken.generatedNewToken", token));
    WrapperProperties.PASSWORD.set(props, token);
    FederatedAuthPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
  }

  public static clearCache(): void {
    FederatedAuthPlugin.tokenCache.clear();
  }
}
