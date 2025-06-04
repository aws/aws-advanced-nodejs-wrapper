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
import { WrapperProperties, WrapperProperty } from "../wrapper_property";
import { AwsWrapperError } from "./errors";
import { Messages } from "./messages";
import { RdsUtils } from "./rds_utils";
import { Signer } from "@aws-sdk/rds-signer";
import {
  AwsCredentialIdentity,
  AwsCredentialIdentityProvider
} from "@smithy/types/dist-types/identity/awsCredentialIdentity";
import { PluginService } from "../plugin_service";
import { TelemetryTraceLevel } from "./telemetry/telemetry_trace_level";

export class IamAuthUtils {
  private static readonly TELEMETRY_FETCH_TOKEN = "fetch IAM token";

  public static getIamHost(props: Map<string, any>, hostInfo: HostInfo): string {
    return WrapperProperties.IAM_HOST.get(props) ? WrapperProperties.IAM_HOST.get(props) : hostInfo.host;
  }

  public static getIamPort(props: Map<string, any>, hostInfo: HostInfo, defaultPort: number): number {
    const port = WrapperProperties.IAM_DEFAULT_PORT.get(props);
    if (port) {
      if (isNaN(port) || port <= 0) {
        logger.debug(Messages.get("Authentication.invalidPort", isNaN(port) ? "-1" : String(port)));
      } else {
        return port;
      }
    }

    if (hostInfo.isPortSpecified()) {
      return hostInfo.port;
    } else {
      return defaultPort;
    }
  }

  public static getRdsRegion(hostname: string, rdsUtils: RdsUtils, props: Map<string, any>, wrapperProperty: WrapperProperty<any>): string {
    const rdsRegion = rdsUtils.getRdsRegion(hostname);

    if (!rdsRegion) {
      const errorMessage = Messages.get("Authentication.unsupportedHostname", hostname);
      logger.debug(errorMessage);
      throw new AwsWrapperError(errorMessage);
    }

    return wrapperProperty.get(props) ? wrapperProperty.get(props) : rdsRegion;
  }

  public static getCacheKey(port: number, user?: string, hostname?: string, region?: string): string {
    return `${region}:${hostname}:${port}:${user}`;
  }

  public static async generateAuthenticationToken(
    hostname: string,
    port: number,
    region: string,
    user: string,
    credentials: AwsCredentialIdentity | AwsCredentialIdentityProvider,
    pluginService: PluginService
  ): Promise<string> {
    const telemetryFactory = pluginService.getTelemetryFactory();
    const telemetryContext = telemetryFactory.openTelemetryContext(IamAuthUtils.TELEMETRY_FETCH_TOKEN, TelemetryTraceLevel.NESTED);
    return await telemetryContext.start(async () => {
      const signer = new Signer({
        hostname: hostname,
        port: port,
        region: region,
        credentials: credentials,
        username: user
      });

      return signer.getAuthToken();
    });
  }
}

export class TokenInfo {
  readonly token: string;
  readonly expiration: number;

  constructor(token: string, expiration: number) {
    this.token = token;
    this.expiration = expiration;
  }

  isExpired(): boolean {
    return Date.now() > this.expiration;
  }
}
