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

import { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types/dist-types/identity/awsCredentialIdentity";
import { PluginService } from "../plugin_service";
import { TokenUtils } from "../utils/token_utils";
import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { TelemetryTraceLevel } from "./telemetry/telemetry_trace_level";

export class DSQLTokenUtils extends TokenUtils {
    private static readonly TELEMETRY_FETCH_TOKEN = "fetch DSQL IAM token";

    public async generateAuthenticationToken(
      hostname: string,
      port: number,
      region: string,
      user: string,
      credentials: AwsCredentialIdentity | AwsCredentialIdentityProvider,
      pluginService: PluginService
    ): Promise<string> {
      const telemetryFactory = pluginService.getTelemetryFactory();
      const telemetryContext = telemetryFactory.openTelemetryContext(DSQLTokenUtils.TELEMETRY_FETCH_TOKEN, TelemetryTraceLevel.NESTED);
      return await telemetryContext.start(async () => {
        const signer = new DsqlSigner({
        hostname: hostname,
        region,
        });

        if (user === "admin") {
          return signer.getDbConnectAdminAuthToken();
        }
        else {
          return signer.getDbConnectAuthToken()
        }
      });
    }
}