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

export class MySQLErrorHandler implements ErrorHandler {
  isLoginError(e: Error): boolean {
    return false;
  }

  isNetworkError(e: Error): boolean {
    return (
      e.message.includes("Connection lost: The server closed the connection.") ||
      e.message.includes("Query inactivity timeout") ||
      e.message.includes("Can't add new command when connection is in closed state") ||
      e.message.includes(Messages.get("ClientUtils.queryTaskTimeout")) ||
      // Pooled connection network errors
      e.message.includes("connect ETIMEDOUT")
    );
  }
}
