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
import { ClientWrapper } from "../../common/lib/client_wrapper";
import { logger } from "../../common/logutils";
import { Messages } from "../../common/lib/utils/messages";

export abstract class AbstractPgErrorHandler implements ErrorHandler {
  protected unexpectedError: Error | null = null;

  abstract getNetworkErrors(): string[];

  abstract getAccessErrorCodes(): string[];

  abstract getAccessErrorMessages(): string[];

  protected noOpListener(error: any) {
    // Ignore the received error.
    logger.silly(Messages.get("ErrorHandler.NoOpListener", "PgErrorHandler", error.message));
  }

  protected trackingListener(error: any) {
    this.unexpectedError = error;
    logger.silly(Messages.get("ErrorHandler.TrackerListener", "PgErrorHandler", error.message));
  }

  isLoginError(e: Error): boolean {
    if (Object.prototype.hasOwnProperty.call(e, "code")) {
      // @ts-ignore
      return this.getAccessErrorCodes().includes(e["code"]);
    }
    for (const accessError of this.getAccessErrorMessages()) {
      if (e.message.includes(accessError)) {
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

  hasLoginError(): boolean {
    return this.unexpectedError !== null && this.isLoginError(this.unexpectedError);
  }

  hasNetworkError(): boolean {
    return this.unexpectedError !== null && this.isNetworkError(this.unexpectedError);
  }

  getUnexpectedError(): Error | null {
    return this.unexpectedError;
  }

  attachErrorListener(clientWrapper: ClientWrapper | undefined): void {
    if (!clientWrapper || !clientWrapper.client) {
      return;
    }
    this.unexpectedError = null;
    clientWrapper.client.removeListener("error", this.noOpListener);
    clientWrapper.client.on("error", this.trackingListener);
  }

  attachNoOpErrorListener(clientWrapper: ClientWrapper | undefined): void {
    if (!clientWrapper || !clientWrapper.client) {
      return;
    }
    clientWrapper.client.removeListener("error", this.trackingListener);
    clientWrapper.client.on("error", this.noOpListener);
  }
}
