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

import { logger } from "../../logutils";
import { HostInfo } from "../host_info";
import { WrapperProperties } from "../wrapper_property";
import { AwsWrapperError } from "./errors";
import { Messages } from "./messages";
import { RdsUtils } from "./rds_utils";
import { Signer } from "@aws-sdk/rds-signer";
import { AwsCredentialIdentityProvider, AwsCredentialIdentity } from "@smithy/types/dist-types/identity/awsCredentialIdentity";

export class IamAuthUtils {
  public static getIamHost(props: Map<string, any>, hostInfo: HostInfo): string {
    return WrapperProperties.IAM_HOST.get(props) ? WrapperProperties.IAM_HOST.get(props) : hostInfo.host;
  }

  public static getIamPort(props: Map<string, any>, hostInfo: HostInfo, defaultPort: number): number {
    const port = WrapperProperties.IAM_DEFAULT_PORT.get(props);
    if (port > 0) {
      return port;
    } else {
      logger.debug(Messages.get("IamAuthenticationPlugin.invalidPort", isNaN(port) ? "-1" : String(port)));
    }

    if (hostInfo.isPortSpecified()) {
      return hostInfo.port;
    } else {
      return defaultPort;
    }
  }

  public static getRdsRegion(hostname: string, rdsUtils: RdsUtils, props: Map<string, any>): string {
    const rdsRegion = rdsUtils.getRdsRegion(hostname);

    if (!rdsRegion) {
      const errorMessage = Messages.get("FederatedAuthPlugin.unsupportedHostname", hostname);
      logger.debug(errorMessage);
      throw new AwsWrapperError(errorMessage);
    }

    return WrapperProperties.IAM_REGION.get(props) ? WrapperProperties.IAM_REGION.get(props) : rdsRegion;
  }

  public static getCacheKey(port: number, user?: string, hostname?: string, region?: string): string {
    return `${region}:${hostname}:${port}:${user}`;
  }

  public static async generateAuthenticationToken(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostname: string,
    port: number,
    region: string,
    user: string,
    credentials: AwsCredentialIdentity | AwsCredentialIdentityProvider
  ): Promise<string> {
    const signer = new Signer({
      hostname: hostname,
      port: port,
      region: region,
      credentials,
      username: user
    });

    return await signer.getAuthToken();
  }
}

export class TokenInfo {
  private readonly _token: string;
  private readonly _expiration: number;

  constructor(token: string, expiration: number) {
    this._token = token;
    this._expiration = expiration;
  }

  get token(): string {
    return this._token;
  }

  get expiration(): number {
    return this._expiration;
  }

  isExpired(): boolean {
    return Date.now() > this._expiration;
  }
}
