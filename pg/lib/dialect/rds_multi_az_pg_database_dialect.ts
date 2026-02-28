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
import { AwsWrapperError, HostRole } from "../../../common/lib";
import { Messages } from "../../../common/lib/utils/messages";
import { TopologyAwareDatabaseDialect } from "../../../common/lib/database_dialect/topology_aware_database_dialect";
import { RdsHostListProvider } from "../../../common/lib/host_list_provider/rds_host_list_provider";
import { PgDatabaseDialect } from "./pg_database_dialect";
import { ErrorHandler } from "../../../common/lib/error_handler";
import { MultiAzPgErrorHandler } from "../multi_az_pg_error_handler";
import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { PluginService } from "../../../common/lib/plugin_service";
import { MonitoringRdsHostListProvider } from "../../../common/lib/host_list_provider/monitoring/monitoring_host_list_provider";
import { TopologyQueryResult, TopologyUtils } from "../../../common/lib/host_list_provider/topology_utils";

export class RdsMultiAZClusterPgDatabaseDialect extends PgDatabaseDialect implements TopologyAwareDatabaseDialect {
  constructor() {
    super();
  }
  private static readonly VERSION = process.env.npm_package_version;
  private static readonly TOPOLOGY_QUERY: string = `SELECT id, endpoint, port FROM rds_tools.show_topology('aws_advanced_nodejs_wrapper-"${RdsMultiAZClusterPgDatabaseDialect.VERSION}"')`;
  private static readonly WRITER_HOST_FUNC_EXIST_QUERY: string =
    "SELECT 1 AS tmp FROM information_schema.routines WHERE routine_schema OPERATOR(pg_catalog.=) 'rds_tools' AND routine_name OPERATOR(pg_catalog.=) 'multi_az_db_cluster_source_dbi_resource_id'";
  private static readonly FETCH_WRITER_HOST_QUERY: string =
    "SELECT multi_az_db_cluster_source_dbi_resource_id FROM rds_tools.multi_az_db_cluster_source_dbi_resource_id()";
  private static readonly FETCH_WRITER_HOST_QUERY_COLUMN_NAME: string = "multi_az_db_cluster_source_dbi_resource_id";
  private static readonly HOST_ID_QUERY: string = "SELECT dbi_resource_id FROM rds_tools.dbi_resource_id()";
  private static readonly HOST_ID_QUERY_COLUMN_NAME: string = "dbi_resource_id";
  private static readonly IS_READER_QUERY: string = "SELECT pg_catalog.pg_is_in_recovery() AS is_reader";
  private static readonly IS_READER_QUERY_COLUMN_NAME: string = "is_reader";
  protected static readonly INSTANCE_ID_QUERY: string =
    "SELECT id as instance_id, SUBSTRING(endpoint FROM 0 FOR POSITION('.' IN endpoint)) as instance_name " +
    "FROM rds_tools.show_topology() " +
    "WHERE id OPERATOR(pg_catalog.=) rds_tools.dbi_resource_id()";

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    const res = await targetClient.query(RdsMultiAZClusterPgDatabaseDialect.WRITER_HOST_FUNC_EXIST_QUERY).catch(() => false);

    if (!res) {
      return false;
    }

    try {
      const res = await targetClient.query(RdsMultiAZClusterPgDatabaseDialect.FETCH_WRITER_HOST_QUERY);
      return res.rows[0][RdsMultiAZClusterPgDatabaseDialect.FETCH_WRITER_HOST_QUERY_COLUMN_NAME] != null;
    } catch (e: any) {
      return false;
    }
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    const topologyUtils: TopologyUtils = new TopologyUtils(this, hostListProviderService.getHostInfoBuilder());
    if (WrapperProperties.PLUGINS.get(props).includes("failover2")) {
      return new MonitoringRdsHostListProvider(
        props,
        originalUrl,
        topologyUtils,
        hostListProviderService,
        <PluginService>(<unknown>hostListProviderService)
      );
    }
    return new RdsHostListProvider(props, originalUrl, topologyUtils, hostListProviderService);
  }

  async queryForTopology(targetClient: ClientWrapper): Promise<TopologyQueryResult[]> {
    try {
      let writerHostId: string = await this.executeTopologyRelatedQuery(
        targetClient,
        RdsMultiAZClusterPgDatabaseDialect.FETCH_WRITER_HOST_QUERY,
        RdsMultiAZClusterPgDatabaseDialect.FETCH_WRITER_HOST_QUERY_COLUMN_NAME
      );
      if (!writerHostId) {
        writerHostId = await this.identifyConnection(targetClient);
      }

      const res = await targetClient.query(RdsMultiAZClusterPgDatabaseDialect.TOPOLOGY_QUERY);
      const rows: any[] = res.rows;
      return this.processTopologyQueryResults(writerHostId, rows);
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("RdsMultiAZPgDatabaseDialect.invalidQuery", error.message));
    }
  }

  private async executeTopologyRelatedQuery(targetClient: ClientWrapper, query: string, resultColumnName?: string): Promise<any> {
    const res = await targetClient.query(query);
    const rows: any[] = res.rows;
    if (rows.length > 0) {
      return rows[0][resultColumnName ?? 0];
    }
    return "";
  }

  private async processTopologyQueryResults(writerHostId: string, rows: any[]): Promise<TopologyQueryResult[]> {
    const hosts: TopologyQueryResult[] = [];
    rows.forEach((row) => {
      // According to the topology query the result set
      // should contain 3 columns: endpoint, id, and port
      const endpoint: string = row["endpoint"];
      const id: string = row["id"];
      const port: number = row["port"];
      const isWriter: boolean = id === writerHostId;
      const host: TopologyQueryResult = new TopologyQueryResult({
        host: endpoint.substring(0, endpoint.indexOf(".")),
        isWriter: isWriter,
        weight: 0,
        lastUpdateTime: Date.now(),
        port: port
      });
      hosts.push(host);
    });
    return hosts;
  }

  async getHostRole(client: ClientWrapper): Promise<HostRole> {
    return (await this.executeTopologyRelatedQuery(
      client,
      RdsMultiAZClusterPgDatabaseDialect.IS_READER_QUERY,
      RdsMultiAZClusterPgDatabaseDialect.IS_READER_QUERY_COLUMN_NAME
    )) === false
      ? HostRole.WRITER
      : HostRole.READER;
  }

  async getWriterId(targetClient: ClientWrapper): Promise<string | null> {
    try {
      const writerHostId: string = await this.executeTopologyRelatedQuery(
        targetClient,
        RdsMultiAZClusterPgDatabaseDialect.FETCH_WRITER_HOST_QUERY,
        RdsMultiAZClusterPgDatabaseDialect.FETCH_WRITER_HOST_QUERY_COLUMN_NAME
      );
      const currentConnection = await this.identifyConnection(targetClient);

      return currentConnection && currentConnection === writerHostId ? currentConnection : null;
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("RdsMultiAZPgDatabaseDialect.invalidQuery", error.message));
    }
  }

  async getInstanceId(targetClient: ClientWrapper): Promise<[string, string]> {
    try {
      const res = await targetClient.query(RdsMultiAZClusterPgDatabaseDialect.INSTANCE_ID_QUERY);
      const instance_id = res.rows[0]["instance_id"];
      const instance_name = res.rows[0]["instance_name"];
      return [instance_id, instance_name];
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("RdsMultiAZPgDatabaseDialect.invalidQuery", error.message));
    }
  }

  getErrorHandler(): ErrorHandler {
    return new MultiAzPgErrorHandler();
  }

  async identifyConnection(client: ClientWrapper): Promise<string> {
    return await this.executeTopologyRelatedQuery(
      client,
      RdsMultiAZClusterPgDatabaseDialect.HOST_ID_QUERY,
      RdsMultiAZClusterPgDatabaseDialect.HOST_ID_QUERY_COLUMN_NAME
    );
  }

  getDialectUpdateCandidates(): string[] {
    return [];
  }
}
