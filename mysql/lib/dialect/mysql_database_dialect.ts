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

import { DatabaseDialect } from "aws-wrapper-common-lib/lib/database_dialect";
import { HostListProviderService } from "aws-wrapper-common-lib/lib/host_list_provider_service";
import { HostListProvider } from "aws-wrapper-common-lib/lib/host_list_provider/host_list_provider";
import { ConnectionStringHostListProvider } from "aws-wrapper-common-lib/lib/host_list_provider/connection_string_host_list_provider";
import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";
import { AwsWrapperError } from "aws-wrapper-common-lib/lib/utils/errors";

export class MySQLDatabaseDialect implements DatabaseDialect {
  getDefaultPort(): number {
    return 3306;
  }

  getDialectUpdateCandidates(): string[] {
    return [];
  }

  getHostAliasQuery(): string {
    return "SELECT CONCAT(@@hostname, ':', @@port)";
  }

  async getHostAliasAndParseResults(client: AwsClient): Promise<string> {
    return client.targetClient
      .promise()
      .query(this.getHostAliasQuery())
      .then(([rows]: any) => {
        return rows[0]["CONCAT(@@hostname, ':', @@port)"];
      })
      .catch((error: any) => {
        throw new AwsWrapperError("Unable to fetch host alias or could not parse results: ", error);
      });
  }

  getServerVersionQuery(): string {
    return "SHOW VARIABLES LIKE 'version_comment'";
  }

  isDialect<Connection>(conn: Connection): boolean {
    return false;
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    return new ConnectionStringHostListProvider(props, originalUrl, this.getDefaultPort(), hostListProviderService);
  }
}
