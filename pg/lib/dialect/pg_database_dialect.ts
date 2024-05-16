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

import { DatabaseDialect, DatabaseType } from "aws-wrapper-common-lib/lib/database_dialect/database_dialect";
import { HostListProviderService } from "aws-wrapper-common-lib/lib/host_list_provider_service";
import { HostListProvider } from "aws-wrapper-common-lib/lib/host_list_provider/host_list_provider";
import { ConnectionStringHostListProvider } from "aws-wrapper-common-lib/lib/host_list_provider/connection_string_host_list_provider";
import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";
import { AwsWrapperError } from "aws-wrapper-common-lib/lib/utils/errors";
import { DatabaseDialectCodes } from "aws-wrapper-common-lib/lib/database_dialect/database_dialect_codes";

export class PgDatabaseDialect implements DatabaseDialect {
  protected dialectName: string = "PgDatabaseDialect";
  protected defaultPort: number = 5432;

  getDefaultPort(): number {
    return this.defaultPort;
  }

  getDialectUpdateCandidates(): string[] {
    return [DatabaseDialectCodes.AURORA_PG, DatabaseDialectCodes.RDS_PG];
  }

  getHostAliasQuery(): string {
    return "SELECT CONCAT(inet_server_addr(), ':', inet_server_port())";
  }

  async getHostAliasAndParseResults(client: AwsClient): Promise<string> {
    return client.targetClient
      .query(this.getHostAliasQuery())
      .then((rows: any) => {
        return rows.rows[0]["concat"];
      })
      .catch((error: any) => {
        throw new AwsWrapperError("Unable to fetch host alias or could not parse results: ", error);
      });
  }

  getServerVersionQuery(): string {
    return "SELECT 'version', VERSION()";
  }

  async isDialect(targetClient: any): Promise<boolean> {
    return await targetClient
      .query("SELECT 1 FROM pg_proc LIMIT 1")
      .then((result: { rows: any }) => {
        return !!result.rows[0];
      })
      .catch(() => {
        return false;
      });
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    return new ConnectionStringHostListProvider(props, originalUrl, this.getDefaultPort(), hostListProviderService);
  }

  async tryClosingTargetClient(targetClient: any) {
    await targetClient.end().catch((error: any) => {
      // ignore
    });
  }

  async isClientValid(targetClient: any): Promise<boolean> {
    try {
      return Promise.resolve(targetClient._connected || targetClient._connecting);
    } catch (error) {
      return false;
    }
  }

  getConnectFunc(targetClient: any): () => Promise<any> {
    return async () => {
      return await targetClient.connect();
    };
  }

  getDatabaseType(): DatabaseType {
    return DatabaseType.POSTGRES;
  }

  getDialectName(): string {
    return this.dialectName;
  }
}
