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

import { MySQLDatabaseDialect } from "./mysql_database_dialect";
import { HostListProviderService } from "../../../common/lib/host_list_provider_service";
import { HostListProvider } from "../../../common/lib/host_list_provider/host_list_provider";
import { ClientWrapper } from "../../../common/lib/client_wrapper";
import { HostRole } from "../../../common/lib/host_role";
import { Messages } from "../../../common/lib/utils/messages";
import { AwsWrapperError } from "../../../common/lib/utils/errors";
import { TopologyAwareDatabaseDialect } from "../../../common/lib/database_dialect/topology_aware_database_dialect";
import { RdsHostListProvider } from "../../../common/lib/host_list_provider/rds_host_list_provider";
import { FailoverRestriction } from "../../../common/lib/plugins/failover/failover_restriction";
import { WrapperProperties } from "../../../common/lib/wrapper_property";
import { PluginService } from "../../../common/lib/plugin_service";
import {
  MonitoringRdsHostListProvider
} from "../../../common/lib/host_list_provider/monitoring/monitoring_host_list_provider";
import { TopologyQueryResult, TopologyUtils } from "../../../common/lib/host_list_provider/topology_utils";
import { RdsTopologyUtils } from "../../../common/lib/host_list_provider/aurora_topology_utils";

export class RdsMultiAZClusterMySQLDatabaseDialect extends MySQLDatabaseDialect implements TopologyAwareDatabaseDialect {
  private static readonly TOPOLOGY_QUERY: string = "SELECT id, endpoint, port FROM mysql.rds_topology";
  private static readonly TOPOLOGY_TABLE_EXIST_QUERY: string =
    "SELECT 1 AS tmp FROM information_schema.tables WHERE" + " table_schema = 'mysql' AND table_name = 'rds_topology'";
  // For reader hosts, the query should return a writer host id. For a writer host, the query should return no data.
  private static readonly FETCH_WRITER_HOST_QUERY: string = "SHOW REPLICA STATUS";
  private static readonly FETCH_WRITER_HOST_QUERY_COLUMN_NAME: string = "Source_Server_Id";
  private static readonly HOST_ID_QUERY: string = "SELECT @@server_id AS host";
  private static readonly HOST_ID_QUERY_COLUMN_NAME: string = "host";
  private static readonly IS_READER_QUERY: string = "SELECT @@read_only AS is_reader";
  private static readonly IS_READER_QUERY_COLUMN_NAME: string = "is_reader";
  protected static readonly INSTANCE_ID_QUERY: string =
    "SELECT id as instance_id, SUBSTRING_INDEX(endpoint, '.', 1) as instance_name FROM mysql.rds_topology WHERE id = @@server_id";

  async isDialect(targetClient: ClientWrapper): Promise<boolean> {
    let res = await targetClient.query(RdsMultiAZClusterMySQLDatabaseDialect.TOPOLOGY_TABLE_EXIST_QUERY).catch(() => false);

    if (!res) {
      return false;
    }

    res = await targetClient.query(RdsMultiAZClusterMySQLDatabaseDialect.TOPOLOGY_QUERY).catch(() => false);
    if (!res) {
      return false;
    }

    return await targetClient
      .query("SHOW VARIABLES LIKE 'report_host'")
      .then((res) => {
        // | Variable\_name | Value |
        // | :--- | :--- |
        // | report\_host | 0.0.0.0 |

        if (!res) {
          return false;
        }

        return !!res[0][0]["Value"];
      })
      .catch(() => false);
  }

  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider {
    const topologyUtils: TopologyUtils = new RdsTopologyUtils(this, hostListProviderService.getHostInfoBuilder());
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
        RdsMultiAZClusterMySQLDatabaseDialect.FETCH_WRITER_HOST_QUERY,
        RdsMultiAZClusterMySQLDatabaseDialect.FETCH_WRITER_HOST_QUERY_COLUMN_NAME
      );
      if (!writerHostId) {
        writerHostId = await this.identifyConnection(targetClient);
      }

      const res = await targetClient.query(RdsMultiAZClusterMySQLDatabaseDialect.TOPOLOGY_QUERY);
      const rows: any[] = res[0];
      return this.processTopologyQueryResults(writerHostId, rows);
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("RdsMultiAZMySQLDatabaseDialect.invalidQuery", error.message));
    }
  }

  private async executeTopologyRelatedQuery(targetClient: ClientWrapper, query: string, resultColumnName?: string): Promise<string> {
    const res = await targetClient.query(query);
    const rows: any[] = res[0];
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
      const host: TopologyQueryResult = new TopologyQueryResult(endpoint.substring(0, endpoint.indexOf(".")), isWriter, 0, Date.now(), port);
      hosts.push(host);
    });
    return hosts;
  }

  async getHostRole(client: ClientWrapper): Promise<HostRole> {
    return (await this.executeTopologyRelatedQuery(
      client,
      RdsMultiAZClusterMySQLDatabaseDialect.INSTANCE_ID_QUERY,
      RdsMultiAZClusterMySQLDatabaseDialect.IS_READER_QUERY_COLUMN_NAME
    )) == "0"
      ? HostRole.WRITER
      : HostRole.READER;
  }

  async getWriterId(targetClient: ClientWrapper): Promise<string> {
    try {
      const writerHostId: string = await this.executeTopologyRelatedQuery(
        targetClient,
        RdsMultiAZClusterMySQLDatabaseDialect.FETCH_WRITER_HOST_QUERY,
        RdsMultiAZClusterMySQLDatabaseDialect.FETCH_WRITER_HOST_QUERY_COLUMN_NAME
      );
      // The above query returns the writer host id if it is a reader, nothing if the writer.
      if (!writerHostId) {
        const currentConnection = await this.identifyConnection(targetClient);
        return currentConnection ?? null;
      }
      return writerHostId;
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("RdsMultiAZMySQLDatabaseDialect.invalidQuery", error.message));
    }
  }

  async getInstanceId(targetClient: ClientWrapper): Promise<[string, string]> {
    try {
      const res = await targetClient.query(RdsMultiAZClusterMySQLDatabaseDialect.INSTANCE_ID_QUERY);
      const instance_id = res[0][0]["instance_id"];
      const instance_name = res[0][0]["instance_name"];
      return [instance_id, instance_name];
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("RdsMultiAZMySQLDatabaseDialect.invalidQuery", error.message));
    }
  }

  async identifyConnection(client: ClientWrapper): Promise<string> {
    return await this.executeTopologyRelatedQuery(
      client,
      RdsMultiAZClusterMySQLDatabaseDialect.HOST_ID_QUERY,
      RdsMultiAZClusterMySQLDatabaseDialect.HOST_ID_QUERY_COLUMN_NAME
    );
  }

  getDialectUpdateCandidates(): string[] {
    return [];
  }

  getFailoverRestrictions(): FailoverRestriction[] {
    return [FailoverRestriction.DISABLE_TASK_A, FailoverRestriction.ENABLE_WRITER_IN_TASK_B];
  }
}
