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

import { ConnectionUrlParser } from "../../common/lib/utils/connection_url_parser";

export class MySQLConnectionUrlParser extends ConnectionUrlParser {
  /**
   * MySQl2 accepts either a hostname or a connection string when establishing a connection, e.g.:
   * - mysql://root:password@localhost:port/dbName
   * - example.aslfdewrlk.us-east-1.rds.amazonaws.com
   */

  private static readonly PROTOCOL = "mysql://";
  private static readonly TCP_CONNECTION_STRING_PATTERN = /mysql:\/\/(?:([^@\s]+)@)?(?<hosts>([^/\s]+))(?:\/(\w+))?(?:\?(.+))?/i;
  getHostPortPairsFromUrl(initialConnection: string): string[] {
    if (!initialConnection.startsWith(MySQLConnectionUrlParser.PROTOCOL)) {
      return [initialConnection];
    }

    const match = initialConnection.match(MySQLConnectionUrlParser.TCP_CONNECTION_STRING_PATTERN);
    if (match && match.groups) {
      const hosts = match.groups["hosts"];
      if (hosts) {
        return hosts.trim().split(ConnectionUrlParser.HOST_SEPARATOR);
      }
    }
    return [];
  }
}
