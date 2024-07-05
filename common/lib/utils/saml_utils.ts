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

import { WrapperProperties } from "../wrapper_property";
import { AwsWrapperError } from "./errors";
import { Messages } from "./messages";

export class SamlUtils {
  private static readonly HTTPS_URL_PATTERN = new RegExp("^(https)://[-a-zA-Z0-9+&@#/%?=~_!:,.']*[-a-zA-Z0-9+&@#/%=~_']");

  public static checkIdpCredentialsWithFallback(props: Map<string, any>): void {
    if (!WrapperProperties.IDP_USERNAME.get(props)) {
      WrapperProperties.IDP_USERNAME.set(props, WrapperProperties.USER.get(props));
    }
    if (!WrapperProperties.IDP_PASSWORD.get(props)) {
      WrapperProperties.IDP_PASSWORD.set(props, WrapperProperties.PASSWORD.get(props));
    }
  }

  public static validateUrl(url: string): void {
    if (!url.match(SamlUtils.HTTPS_URL_PATTERN)) {
      throw new AwsWrapperError(Messages.get("AdfsCredentialsProviderFactory.invalidHttpsUrl", url));
    }
  }
}
