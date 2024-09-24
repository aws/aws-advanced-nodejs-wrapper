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

import { HostListProviderService } from "../../../common/lib/host_list_provider_service";
import { HostListProvider } from "../../../common/lib/host_list_provider/host_list_provider";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { HostInfo } from "../../../common/lib/host_info";
import { HostRole } from "../../../common/lib/host_role";
import { Messages } from "../../../common/lib/utils/messages";
import { logger } from "../../../common/logutils";
import { AwsWrapperError } from "../../../common/lib/utils/errors";
import { TopologyAwareDatabaseDialect } from "../../../common/lib/topology_aware_database_dialect";
import { HostAvailability } from "../../../common/lib/host_availability/host_availability";
import { HostInfoBuilder } from "../../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../../common/lib/host_availability/simple_host_availability_strategy";
import { RdsHostListProvider } from "../../../common/lib/host_list_provider/rds_host_list_provider";
import { PgDatabaseDialect } from "./pg_database_dialect";

export class RdsMultiAZPgDatabaseDialect extends PgDatabaseDialect implements TopologyAwareDatabaseDialect {
  private static readonly VERSION = process.env.npm_package_version;
  private static readonly TOPOLOGY_QUERY: string = `SELECT id, endpoint, port FROM rds_tools.show_topology('aws_advanced_nodejs_wrapper-"${RdsMultiAZPgDatabaseDialect.VERSION}"')`;
  private static readonly WRITER_HOST_FUNC_EXIST_QUERY: string =
    "SELECT 1 AS tmp FROM information_schema.routines WHERE routine_schema='rds_tools' AND routine_name='multi_az_db_cluster_source_dbi_resource_id'";
  private static readonly FETCH_WRITER_HOST_QUERY: string =
    "SELECT multi_az_db_cluster_source_dbi_resource_id FROM rds_tools.multi_az_db_cluster_source_dbi_resource_id()";
  private static readonly FETCH_WRITER_HOST_QUERY_COLUMN_NAME: string = "multi_az_db_cluster_source_dbi_resource_id";
  private static readonly HOST_ID_QUERY: string = "SELECT dbi_resource_id FROM rds_tools.dbi_resource_id()";
  private static readonly HOST_ID_QUERY_COLUMN_NAME: string = "dbi_resource_id";
  private static readonly IS_READER_QUERY: string = "SELECT pg_is_in_recovery()";

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    const res = await targetClient.client.query(RdsMultiAZPgDatabaseDialect.WRITER_HOST_FUNC_EXIST_QUERY).catch(() => false);

    if (!res) {
      return false;
    }

    return !!(await targetClient.client.query(RdsMultiAZPgDatabaseDialect.FETCH_WRITER_HOST_QUERY).catch(() => false));
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    return new RdsHostListProvider(props, originalUrl, hostListProviderService);
  }

  async queryForTopology(targetClient: ClientWrapper, hostListProvider: HostListProvider): Promise<HostInfo[]> {
    try {
      let writerHostId: string = await this.executeTopologyRelatedQuery(
        targetClient,
        RdsMultiAZPgDatabaseDialect.FETCH_WRITER_HOST_QUERY,
        RdsMultiAZPgDatabaseDialect.FETCH_WRITER_HOST_QUERY_COLUMN_NAME
      );
      if (!writerHostId) {
        writerHostId = await this.identifyConnection(targetClient, new Map<string, any>());
      }

      const res = await targetClient.client.query(RdsMultiAZPgDatabaseDialect.TOPOLOGY_QUERY);
      const rows: any[] = res.rows;
      return this.processTopologyQueryResults(hostListProvider, writerHostId, rows);
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("RdsMultiAZPgDatabaseDialect.invalidQuery", error.message));
    }
  }

  private async executeTopologyRelatedQuery(targetClient: ClientWrapper, query: string, resultColumnName?: string): Promise<string> {
    const res = await targetClient.client.query(query);
    const rows: any[] = res.rows;
    if (rows.length > 0) {
      return rows[0][resultColumnName ?? 0];
    }
    return "";
  }

  private async processTopologyQueryResults(hostListProvider: HostListProvider, writerHostId: string, rows: any[]): Promise<HostInfo[]> {
    const hostMap: Map<string, HostInfo> = new Map<string, HostInfo>();
    rows.forEach((row) => {
      // According to the topology query the result set
      // should contain 3 columns: endpoint, id, and port
      const endpoint: string = row["endpoint"];
      const id: string = row["id"];
      const port: number = row["port"];
      const isWriter: boolean = id === writerHostId;

      // const host: HostInfo = hostListProvider.createHost(endpoint, isWriter, 0, Date.now(), port);
      const host: HostInfo = new HostInfoBuilder({ hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy() })
        .withHost(endpoint)
        .withPort(port ?? -1)
        .withRole(isWriter ? HostRole.WRITER : HostRole.READER)
        .withAvailability(HostAvailability.AVAILABLE)
        .withWeight(0)
        .withLastUpdateTime(Date.now())
        .withHostId(id)
        .build();
      host.addAlias(endpoint);
      hostMap.set(host.host, host);
    });

    let hosts: HostInfo[] = [];
    const writers: HostInfo[] = [];

    for (const [key, info] of hostMap.entries()) {
      if (info.role !== HostRole.WRITER) {
        hosts.push(info);
      } else {
        writers.push(info);
      }
    }

    const writerCount: number = writers.length;
    if (writerCount === 0) {
      logger.error(Messages.get("RdsMultiAzDatabaseDialect.invalidTopology", this.dialectName));
      hosts = [];
    } else {
      hosts.push(writers[0]);
    }

    return hosts;
  }

  async getHostRole(client: ClientWrapper, props: Map<string, any>): Promise<HostRole> {
    return (await this.executeTopologyRelatedQuery(client, RdsMultiAZPgDatabaseDialect.IS_READER_QUERY)) ? HostRole.WRITER : HostRole.READER;
  }

  async identifyConnection(client: ClientWrapper, props: Map<string, any>): Promise<string> {
    return await this.executeTopologyRelatedQuery(
      client,
      RdsMultiAZPgDatabaseDialect.HOST_ID_QUERY,
      RdsMultiAZPgDatabaseDialect.HOST_ID_QUERY_COLUMN_NAME
    );
  }

  getDialectUpdateCandidates(): string[] {
    return [""];
  }
}
