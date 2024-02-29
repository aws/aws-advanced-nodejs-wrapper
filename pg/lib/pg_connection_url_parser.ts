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

import { ConnectionUrlParser } from "aws-wrapper-common-lib/lib/utils/connection_url_parser";

export class PgConnectionUrlParser extends ConnectionUrlParser {
  /**
   * The node-postgres library supports several formats of the connection URL.
   * Some examples include:
   * - /cloudsql/myproject:zone:mydb (UNIX socket domain)
   * - postgresql://dbuser:secretpassword@database.server.com:3211/mydb (TCP connection)
   * - example.aslfdewrlk.us-east-1.rds.amazonaws.com
   */

  private static readonly PROTOCOL = "postgres://";
  private static readonly TCP_CONNECTION_STRING_PATTERN = /postgres:\/\/(?:([^@\s]+)@)?(?<hosts>([^/\s]+))(?:\/(\w+))?(?:\?(.+))?/i;

  getHostPortPairsFromUrl(initialConnection: string): string[] {
    // The URL could either be the hostname, a UNIX socket domain or a TCP connection url.
    if (initialConnection.startsWith("socket:")) {
      // TODO: support UNIX domain socket?
      throw new Error("UNIX domain socket url pattern unsupported");
    }

    if (!initialConnection.startsWith(PgConnectionUrlParser.PROTOCOL)) {
      // If the URL doesn't start with either socket:// or postgres:// then it is a hostname.
      return [initialConnection];
    }

    const match = initialConnection.match(PgConnectionUrlParser.TCP_CONNECTION_STRING_PATTERN);
    if (match && match.groups) {
      const hosts = match.groups["hosts"];
      if (hosts) {
        return hosts.trim().split(ConnectionUrlParser.HOST_SEPARATOR);
      }
    }

    return [];
  }
}
