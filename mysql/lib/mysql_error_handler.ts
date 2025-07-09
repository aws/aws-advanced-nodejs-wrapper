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
import { Messages } from "../../common/lib/utils/messages";
import { logger } from "../../common/logutils";
import { ClientWrapper } from "../../common/lib/client_wrapper";

export class MySQLErrorHandler implements ErrorHandler {
  private static readonly SQLSTATE_ACCESS_ERROR = "28000";
  private unexpectedError: Error | null = null;
  protected static readonly SYNTAX_ERROR_CODES = ["42000", "42S02"];
  protected static readonly SYNTAX_ERROR_MESSAGE = "You have an error in your SQL syntax";

  protected noOpListener(error: any) {
    // Ignore the received error.
    logger.silly(Messages.get("ErrorHandler.NoOpListener", "MySQLErrorHandler", error.message));
  }

  protected trackingListener(error: any) {
    this.unexpectedError = error;
    logger.silly(Messages.get("ErrorHandler.TrackerListener", "MySQLErrorHandler", error.message));
  }

  isLoginError(e: Error): boolean {
    if (Object.prototype.hasOwnProperty.call(e, "sqlState")) {
      // @ts-ignore
      return e["sqlState"] === MySQLErrorHandler.SQLSTATE_ACCESS_ERROR;
    }
    return e.message.includes("Access denied");
  }

  isNetworkError(e: Error): boolean {
    return (
      e.message.includes("Connection lost: The server closed the connection.") ||
      e.message.includes("Query inactivity timeout") ||
      e.message.includes("Can't add new command when connection is in closed state") ||
      e.message.includes(Messages.get("ClientUtils.queryTaskTimeout")) ||
      // Pooled connection network errors
      e.message.includes("connect ETIMEDOUT") ||
      e.message.includes("connect ECONNREFUSED")
    );
  }

  isSyntaxError(e: Error): boolean {
    if (Object.prototype.hasOwnProperty.call(e, "code")) {
      // @ts-ignore
      for (const code of MySQLErrorHandler.SYNTAX_ERROR_CODES) {
        if (e["code"] === code) {
          return true;
        }
      }
    }
    return e.message.includes(MySQLErrorHandler.SYNTAX_ERROR_MESSAGE);
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
