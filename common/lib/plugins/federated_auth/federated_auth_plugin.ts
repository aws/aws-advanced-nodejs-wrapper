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
import { AwsCredentialIdentityProvider } from "@smithy/types/dist-types/identity/awsCredentialIdentity";
import { HostInfo } from "../../host_info";
import { IamAuthUtils, TokenInfo } from "../../utils/iam_auth_utils";
import { WrapperProperties } from "../../wrapper_property";
import { logger } from "../../../logutils";
import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";
import { AwsCredentialsManager } from "../../authentication/aws_credentials_manager";
import { Signer } from "@aws-sdk/rds-signer";
import { ConnectTimePluginFactory } from "../connect_time_plugin";
import { ConnectionPlugin } from "../../connection_plugin";
import { AdfsCredentialsProviderFactory } from "./adfs_credentials_provider_factory";
import { CredentialsProviderFactory } from "./credentials_provider_factory";

export class FederatedAuthPlugin extends AbstractConnectionPlugin {
  protected static readonly tokenCache = new Map<string, TokenInfo>();
  protected rdsUtils: RdsUtils = new RdsUtils();
  protected pluginService: PluginService;
  private static readonly subscribedMethods = new Set<string>(["connect", "forceConnect"]);
  private static readonly DEFAULT_TOKEN_EXPIRATION_SEC = 15 * 60 - 30;
  private static readonly DEFAULT_HTTP_TIMEOUT_MILLIS = 60000;
  protected static SAML_RESPONSE_PATTERN = new RegExp('SAMLResponse\\W+value="(?<saml>[^"]+)"');
  protected static SAML_RESPONSE_PATTERN_GROUP = "saml";
  protected static HTTPS_URL_PATTERN = new RegExp("^(https)://[-a-zA-Z0-9+&@#/%?=~_!:,.']*[-a-zA-Z0-9+&@#/%=~_']");
  private static TELEMETRY_FETCH_TOKEN = "fetch IAM token";
  private readonly credentialsProviderFactory: CredentialsProviderFactory;

  public getSubscribedMethods(): Set<string> {
    return FederatedAuthPlugin.subscribedMethods;
  }

  constructor(pluginService: PluginService, credentialsProviderFactory: CredentialsProviderFactory) {
    super();
    this.credentialsProviderFactory = credentialsProviderFactory;
    this.pluginService = pluginService;
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, connectFunc);
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, forceConnectFunc);
  }

  async connectInternal<T>(hostInfo: HostInfo, props: Map<string, any>, connectFunc: () => Promise<T>): Promise<T> {
    this.checkIdpCredentialsWithFallback(props);

    const host = IamAuthUtils.getIamHost(props, hostInfo);
    const port = IamAuthUtils.getIamPort(props, hostInfo, this.pluginService.getDialect().getDefaultPort());
    const region: string = WrapperProperties.IAM_REGION.get(props) ? WrapperProperties.IAM_REGION.get(props) : this.getRdsRegion(host);
    const tokenExpirationSec = WrapperProperties.IAM_EXPIRATION.get(props);

    const cacheKey = this.getCacheKey(WrapperProperties.USER.get(props), host, port, region);
    const tokenInfo = FederatedAuthPlugin.tokenCache.get(cacheKey);

    const isCachedToken: boolean = tokenInfo != null && !tokenInfo.isExpired();

    if (isCachedToken && tokenInfo) {
      logger.debug(Messages.get("FederatedAuthPlugin.useCachedIamToken", tokenInfo.token));
      WrapperProperties.PASSWORD.set(props, tokenInfo.token);
    } else {
      const tokenExpiry: number = Date.now() + tokenExpirationSec * 1000;
      const token = await this.generateAuthenticationToken(hostInfo, props, host, port, region);
      logger.debug(Messages.get("FederatedAuthPlugin.generatedNewIamToken", token));
      WrapperProperties.PASSWORD.set(props, token);
      FederatedAuthPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
    }
    this.pluginService.updateConfigWithProperties(props);
    WrapperProperties.USER.set(props, "dbUser");

    try {
      return connectFunc();
    } catch (e) {
      logger.debug(Messages.get("FederatedAuthPlugin.connectException", (e as Error).message));
      if (!this.pluginService.isLoginError(e as Error) || !isCachedToken) {
        throw e;
      }

      const tokenExpiry = Date.now() + tokenExpirationSec * 1000;
      const token = await this.generateAuthenticationToken(hostInfo, props, host, port, region);
      WrapperProperties.PASSWORD.set(props, token);
      FederatedAuthPlugin.tokenCache.set(cacheKey, new TokenInfo(token, tokenExpiry));
      return connectFunc();
    }
  }

  private getRdsRegion(hostname: string): string {
    const rdsRegion: string | null = this.rdsUtils.getRdsRegion(hostname);

    if (!rdsRegion) {
      const errorMessage = Messages.get("FederatedAuthPlugin.unsupportedHostname", "hostname");
      logger.debug(errorMessage);
      throw new AwsWrapperError(errorMessage);
    }

    return rdsRegion;
  }

  private checkIdpCredentialsWithFallback(props: Map<string, any>) {
    if (WrapperProperties.IDP_USERNAME.get(props) === null) {
      WrapperProperties.IDP_USERNAME.set(props, WrapperProperties.USER.get(props));
    }

    if (WrapperProperties.IDP_PASSWORD.get(props) === null) {
      WrapperProperties.IDP_PASSWORD.set(props, WrapperProperties.PASSWORD.get(props));
    }
  }

  protected async generateAuthenticationToken(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostname: string,
    port: number,
    region: string
  ): Promise<string> {
    const user: string = props.get("user");
    const signer = new Signer({
      hostname: hostname,
      port: port,
      region: region,
      credentials: AwsCredentialsManager.getProvider(hostInfo, props),
      username: user
    });

    return await signer.getAuthToken();
  }

  private getCacheKey(user: string, hostname: string, port: number, region: string) {
    return `${region}:${hostname}:${port}:${user}`;
  }

  public static clearCache(): void {
    this.tokenCache.clear();
  }
}

export class FederatedAuthPluginFactory extends ConnectTimePluginFactory {
  getInstance(pluginService: PluginService, properties: Map<string, any>): ConnectionPlugin {
    return new FederatedAuthPlugin(pluginService, this.getCredentialsProvidorFactory(pluginService, properties));
  }

  private getCredentialsProvidorFactory(pluginService: PluginService, properties: Map<string, any>): AdfsCredentialsProviderFactory {
    const idpName = WrapperProperties.IDP_NAME.get(properties);
    if (!idpName || idpName === "adfs") {
      return new AdfsCredentialsProviderFactory(pluginService);
    }
    throw new AwsWrapperError(Messages.get("FederatedAuthPluginFactory.unsupportedIdp", idpName));
  }
}
