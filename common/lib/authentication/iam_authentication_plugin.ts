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

import { ConnectionPlugin } from "../connection_plugin";
import { ConnectionPluginFactory } from "../plugin_factory";
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

export class IamAuthenticationPlugin extends AbstractConnectionPlugin {
  private static readonly SUBSCRIBED_METHODS = new Set<string>(["connect", "forceConnect"]);
  protected static readonly tokenCache = new Map<string, TokenInfo>();
  private pluginService: PluginService;
  rdsUtil: RdsUtils = new RdsUtils();

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;
  }

  getSubscribedMethods(): Set<string> {
    return IamAuthenticationPlugin.SUBSCRIBED_METHODS;
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, isInitialConnection, connectFunc);
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, isInitialConnection, forceConnectFunc);
  }

  private async connectInternal<T>(
    hostInfo: HostInfo,
    props: Map<string, any>,
    isInitialConnection: boolean,
    connectFunc: () => Promise<T>
  ): Promise<T> {
    const user = WrapperProperties.USER.get(props);
    if (!user) {
      throw new AwsWrapperError(`${WrapperProperties.USER} is null or empty`);
    }

    const host = IamAuthUtils.getIamHost(props, hostInfo);
    const region: string = IamAuthUtils.getRdsRegion(host, this.rdsUtil, props);
    const port = IamAuthUtils.getIamPort(props, hostInfo, this.pluginService.getCurrentClient().defaultPort);
    const tokenExpirationSec = WrapperProperties.IAM_TOKEN_EXPIRATION.get(props);

    const cacheKey: string = IamAuthUtils.getCacheKey(port, user, host, region);

    const tokenInfo = IamAuthenticationPlugin.tokenCache.get(cacheKey);
    const isCachedToken: boolean = tokenInfo !== undefined && !tokenInfo.isExpired();

    if (isCachedToken && tokenInfo) {
      logger.debug(Messages.get("IamAuthenticationPlugin.useCachedIamToken", tokenInfo.token));
      WrapperProperties.PASSWORD.set(props, tokenInfo.token);
    } else {
      const tokenExpiry: number = Date.now() + tokenExpirationSec * 1000;
      const token = await IamAuthUtils.generateAuthenticationToken(
        host,
        port,
        region,
        WrapperProperties.USER.get(props),
        AwsCredentialsManager.getProvider(hostInfo, props)
      );
      logger.debug(Messages.get("IamAuthenticationPlugin.generatedNewIamToken", token));
      WrapperProperties.PASSWORD.set(props, token);
      IamAuthenticationPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
    }
    this.pluginService.updateConfigWithProperties(props);

    try {
      return connectFunc();
    } catch (e) {
      logger.debug(Messages.get("IamAuthenticationPlugin.connectException", (e as Error).message));
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
        WrapperProperties.USER.get(props),
        AwsCredentialsManager.getProvider(hostInfo, props)
      );
      logger.debug(Messages.get("IamAuthenticationPlugin.generatedNewIamToken", token));
      WrapperProperties.PASSWORD.set(props, token);
      IamAuthenticationPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
      return connectFunc();
    }
  }

  static clearCache(): void {
    this.tokenCache.clear();
  }
}

export class IamAuthenticationPluginFactory implements ConnectionPluginFactory {
  getInstance(pluginService: PluginService, properties: object): ConnectionPlugin {
    return new IamAuthenticationPlugin(pluginService);
  }
}
