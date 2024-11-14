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

import { AbstractPgErrorHandler } from "./abstract_pg_error_handler";

export class PgErrorHandler extends AbstractPgErrorHandler {
  private static readonly SQLSTATE_ACCESS_ERROR_CODES = ["28000", "28P01"];
  private static readonly ACCESS_ERROR_MESSAGES = ["Access denied", "PAM authentication failed"];
  private static readonly NETWORK_MESSAGES = [
    "Connection terminated unexpectedly",
    "Client has encountered a connection error and is not queryable",
    "Query read timeout",
    "Connection terminated due to connection timeout",
    "read ECONNRESET",
    "connect ECONNREFUSED"
  ];

  getAccessErrorCodes(): string[] {
    return PgErrorHandler.SQLSTATE_ACCESS_ERROR_CODES;
  }

  getAccessErrorMessages(): string[] {
    return PgErrorHandler.ACCESS_ERROR_MESSAGES;
  }

  getNetworkErrors(): string[] {
    return PgErrorHandler.NETWORK_MESSAGES;
  }
}
