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

import { PluginService } from "../plugin_service";
import { RdsUtils } from "../utils/rds_utils";
import { Messages } from "../utils/messages";
import { logger } from "../../logutils";
import { AwsWrapperError } from "../utils/errors";
import { HostInfo } from "../host_info";
import { AwsCredentialsManager } from "./aws_credentials_manager";
import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { WrapperProperties } from "../wrapper_property";
import { IamAuthUtils, TokenInfo } from "../utils/iam_auth_utils";
import { ClientWrapper } from "../client_wrapper";

export class IamAuthenticationPlugin extends AbstractConnectionPlugin {
  private static readonly SUBSCRIBED_METHODS = new Set<string>(["connect", "forceConnect"]);
  protected static readonly tokenCache = new Map<string, TokenInfo>();
  private readonly telemetryFactory;
  private readonly fetchTokenCounter;
  private pluginService: PluginService;
  rdsUtil: RdsUtils = new RdsUtils();

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;
    this.telemetryFactory = this.pluginService.getTelemetryFactory();
    this.fetchTokenCounter = this.telemetryFactory.createCounter("iam.fetchTokenCount");
  }

  getSubscribedMethods(): Set<string> {
    return IamAuthenticationPlugin.SUBSCRIBED_METHODS;
  }

  connect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(hostInfo, props, isInitialConnection, connectFunc);
  }

  forceConnect(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    forceConnectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    return this.connectInternal(hostInfo, props, isInitialConnection, forceConnectFunc);
  }

  private async connectInternal(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<ClientWrapper>
  ): Promise<ClientWrapper> {
    const user = WrapperProperties.USER.get(props);
    if (!user) {
      throw new AwsWrapperError(`${WrapperProperties.USER} is null or empty`);
    }

    const host = IamAuthUtils.getIamHost(props, hostInfo);
    const region: string = IamAuthUtils.getRdsRegion(host, this.rdsUtil, props);
    const port = IamAuthUtils.getIamPort(props, hostInfo, this.pluginService.getCurrentClient().defaultPort);
    const tokenExpirationSec = WrapperProperties.IAM_TOKEN_EXPIRATION.get(props);
    if (tokenExpirationSec < 0) {
      throw new AwsWrapperError(Messages.get("AuthenticationToken.tokenExpirationLessThanZero"));
    }
    const cacheKey: string = IamAuthUtils.getCacheKey(port, user, host, region);

    const tokenInfo = IamAuthenticationPlugin.tokenCache.get(cacheKey);
    const isCachedToken: boolean = tokenInfo !== undefined && !tokenInfo.isExpired();

    if (isCachedToken && tokenInfo) {
      logger.debug(Messages.get("AuthenticationToken.useCachedToken", tokenInfo.token));
      WrapperProperties.PASSWORD.set(props, tokenInfo.token);
    } else {

      const tokenExpiry: number = Date.now() + tokenExpirationSec * 1000;
      const token = await IamAuthUtils.generateAuthenticationToken(
        host,
        port,
        region,
        user,
        AwsCredentialsManager.getProvider(hostInfo, props),
        this.pluginService
      );
      this.fetchTokenCounter.inc();
      logger.debug(Messages.get("AuthenticationToken.generatedNewToken", token));
      WrapperProperties.PASSWORD.set(props, token);
      IamAuthenticationPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
    }
    this.pluginService.updateConfigWithProperties(props);

    try {
      return await connectFunc();
    } catch (e) {
      logger.debug(Messages.get("Authentication.connectException", (e as Error).message));
      if (!this.pluginService.isLoginError(e as Error) || !isCachedToken) {
        throw e;
      }

      // Login unsuccessful with cached token
      // Try to generate a new token and try to connect again

      const tokenExpiry: number = Date.now() + tokenExpirationSec * 1000;
      const token = await IamAuthUtils.generateAuthenticationToken(
        host,
        port,
        region,
        user,
        AwsCredentialsManager.getProvider(hostInfo, props),
        this.pluginService
      );
      this.fetchTokenCounter.inc();
      logger.debug(Messages.get("AuthenticationToken.generatedNewToken", token));
      WrapperProperties.PASSWORD.set(props, token);
      IamAuthenticationPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
      return connectFunc();
    }
  }

  static clearCache(): void {
    IamAuthenticationPlugin.tokenCache.clear();
  }
}
