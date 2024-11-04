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

import { ErrorHandler } from "../../common/lib/error_handler";

export abstract class AbstractPgErrorHandler implements ErrorHandler {
  abstract getNetworkErrors(): string[];

  abstract getAccessErrorCodes(): string[];

  abstract getAccessErrorMessages(): string[];

  isLoginError(e: Error): boolean {
    if (Object.prototype.hasOwnProperty.call(e, "code")) {
      // @ts-ignore
      return this.getAccessErrorCodes().includes(e["code"]);
    }
    for (const accessErrorMessage of this.getAccessErrorMessages()) {
      if (e.message.includes(accessErrorMessage)) {
        return true;
      }
    }
    return false;
  }

  isNetworkError(e: Error): boolean {
    for (const networkError of this.getNetworkErrors()) {
      if (e.message.includes(networkError)) {
        return true;
      }
    }
    return false;
  }
}
