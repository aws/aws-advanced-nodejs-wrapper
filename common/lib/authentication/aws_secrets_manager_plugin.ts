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

import {
  SecretsManagerClientConfig,
  SecretsManagerClient,
  SecretsManagerServiceException,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";
import { logger } from "../../logutils";
import { AbstractConnectionPlugin } from "../abstract_connection_plugin";
import { ConnectionPlugin } from "../connection_plugin";
import { HostInfo } from "../host_info";
import { ConnectionPluginFactory } from "../plugin_factory";
import { PluginService } from "../plugin_service";
import { AwsWrapperError } from "../utils/errors";
import { Messages } from "../utils/messages";
import { WrapperProperties } from "../wrapper_property";

export class AwsSecretsManagerPlugin extends AbstractConnectionPlugin {
  private static SUBSCRIBED_METHODS: Set<string> = new Set<string>(["connect", "forceConnect"]);
  private static SECRETS_ARN_PATTERN: RegExp = new RegExp("^arn:aws:secretsmanager:(?<region>[^:\\n]*):[^:\\n]*:([^:/\\n]*[:/])?(.*)$");
  private readonly pluginService: PluginService;
  private secret: Secret | null = null;
  static secretsCache: Map<string, Secret> = new Map();
  secretKey: SecretCacheKey;
  secretsManagerClient: SecretsManagerClient;

  constructor(pluginService: PluginService, properties: Map<string, any>) {
    super();

    this.pluginService = pluginService;
    const secretId = WrapperProperties.SECRET_ID.get(properties);
    const endpoint = WrapperProperties.SECRET_ENDPOINT.get(properties);
    let region = WrapperProperties.SECRET_REGION.get(properties);
    const config: SecretsManagerClientConfig = {};

    if (!secretId) {
      throw new AwsWrapperError(Messages.get("AwsSecretsManagerConnectionPlugin.missingRequiredConfigParameter"));
    }

    if (!region) {
      const groups = secretId.match(AwsSecretsManagerPlugin.SECRETS_ARN_PATTERN)?.groups;
      if (groups?.region) {
        region = groups.region;
      }
      config.region = region;
    }

    if (endpoint) {
      config.endpoint = endpoint;
    }

    this.secretKey = new SecretCacheKey(secretId, region);
    this.secretsManagerClient = new SecretsManagerClient(config);
  }

  getSubscribedMethods(): Set<string> {
    return AwsSecretsManagerPlugin.SUBSCRIBED_METHODS;
  }

  connect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, connectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, connectFunc);
  }

  forceConnect<T>(hostInfo: HostInfo, props: Map<string, any>, isInitialConnection: boolean, forceConnectFunc: () => Promise<T>): Promise<T> {
    return this.connectInternal(hostInfo, props, forceConnectFunc);
  }

  private async connectInternal<T>(hostInfo: HostInfo, props: Map<string, any>, connectFunc: () => Promise<T>): Promise<T> {
    let secretWasFetched = await this.updateSecret(false);
    try {
      WrapperProperties.USER.set(props, this.secret?.username ?? "");
      WrapperProperties.PASSWORD.set(props, this.secret?.password ?? "");
      this.pluginService.updateConfigWithProperties(props);
      return await connectFunc();
    } catch (error) {
      if (error instanceof Error) {
        if ((error.message.includes("password authentication failed") || error.message.includes("Access denied")) && !secretWasFetched) {
          // Login unsuccessful with cached credentials
          // Try to re-fetch credentials and try again

          secretWasFetched = await this.updateSecret(true);
          if (secretWasFetched) {
            WrapperProperties.USER.set(props, this.secret?.username ?? "");
            WrapperProperties.PASSWORD.set(props, this.secret?.password ?? "");
            return await connectFunc();
          }
        }
        logger.debug(Messages.get("AwsSecretsManagerConnectionPlugin.unhandledException", error.name, error.message));
      }
      throw error;
    }
  }

  private async updateSecret(forceRefresh: boolean): Promise<boolean> {
    let fetched = false;
    this.secret = AwsSecretsManagerPlugin.secretsCache.get(JSON.stringify(this.secretKey)) ?? null;

    if (!this.secret || forceRefresh) {
      try {
        this.secret = await this.fetchLatestCredentials();
        fetched = true;
        AwsSecretsManagerPlugin.secretsCache.set(JSON.stringify(this.secretKey), this.secret);
      } catch (error) {
        if (error instanceof SecretsManagerServiceException) {
          this.logAndThrowError(Messages.get("AwsSecretsManagerConnectionPlugin.failedToFetchDbCredentials"));
        } else if (error instanceof Error && error.message.includes("AWS SDK error")) {
          this.logAndThrowError(Messages.get("AwsSecretsManagerConnectionPlugin.endpointOverrideInvalidConnection", error.message));
        } else {
          this.logAndThrowError(Messages.get("AwsSecretsManagerConnectionPlugin.unhandledException", JSON.stringify(error)));
        }
      }
    }

    return fetched;
  }

  private async fetchLatestCredentials(): Promise<Secret> {
    const commandInput = {
      SecretId: this.secretKey.secretId
    };
    const command = new GetSecretValueCommand(commandInput);
    const result = await this.secretsManagerClient.send(command);
    const secret = new Secret(JSON.parse(result.SecretString ?? "").username, JSON.parse(result.SecretString ?? "").password);
    if (secret && secret.username && secret.password) {
      return secret;
    }
    throw new AwsWrapperError(Messages.get("AwsSecretsManagerConnectionPlugin.failedToFetchDbCredentials"));
  }

  private logAndThrowError(message: string) {
    logger.debug(message);
    throw new AwsWrapperError(message);
  }
}

export class SecretCacheKey {
  private readonly _secretId: string;
  private readonly _region: string | null;

  constructor(secretId: string, region: string) {
    this._secretId = secretId;
    this._region = region;
  }

  get secretId(): string {
    return this._secretId;
  }

  get region(): string | null {
    return this._region;
  }
}

export class Secret {
  private readonly _username: string;
  private readonly _password: string;

  constructor(username: string, password: string) {
    this._username = username;
    this._password = password;
  }

  get username(): string {
    return this._username;
  }

  get password(): string | null {
    return this._password;
  }
}

export class AwsSecretsManagerPluginFactory implements ConnectionPluginFactory {
  getInstance(pluginService: PluginService, properties: Map<string, any>): ConnectionPlugin {
    return new AwsSecretsManagerPlugin(pluginService, new Map(properties));
  }
}