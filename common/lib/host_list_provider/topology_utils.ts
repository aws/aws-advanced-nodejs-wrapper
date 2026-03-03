/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ClientWrapper } from "../client_wrapper";
import { DatabaseDialect } from "../database_dialect/database_dialect";
import { HostInfo } from "../host_info";
import { isDialectTopologyAware } from "../utils/utils";
import { Messages } from "../utils/messages";
import { HostRole } from "../host_role";
import { HostAvailability } from "../host_availability/host_availability";
import { HostInfoBuilder } from "../host_info_builder";
import { AwsWrapperError } from "../utils/errors";
import { TopologyAwareDatabaseDialect } from "../database_dialect/topology_aware_database_dialect";

/**
 * Options for creating a TopologyQueryResult instance.
 */
export interface TopologyQueryResultOptions {
  host: string;
  isWriter: boolean;
  weight: number;
  lastUpdateTime?: number;
  port?: number;
  id?: string;
  endpoint?: string;
  awsRegion?: string;
}

/**
 * Represents the result of a topology query for a single database instance.
 * Contains information about the instance's role, weight, and connection details.
 */
export class TopologyQueryResult {
  host: string;
  isWriter: boolean;
  weight: number;
  lastUpdateTime?: number;
  port?: number;
  id?: string;
  endpoint?: string;
  awsRegion?: string;

  constructor(options: TopologyQueryResultOptions) {
    this.host = options.host;
    this.isWriter = options.isWriter;
    this.weight = options.weight;
    this.lastUpdateTime = options.lastUpdateTime;
    this.port = options.port;
    this.id = options.id;
    this.endpoint = options.endpoint;
    this.awsRegion = options.awsRegion;
  }
}

/**
 * A class defining utility methods that can be used to retrieve and process a variety of database topology
 * information. This class can be overridden to define logic specific to various database engine deployments
 * (e.g. Aurora, Multi-AZ, Global Aurora etc.).
 */
export class TopologyUtils {
  protected readonly dialect: TopologyAwareDatabaseDialect;
  protected readonly hostInfoBuilder: HostInfoBuilder;

  constructor(dialect: TopologyAwareDatabaseDialect, hostInfoBuilder: HostInfoBuilder) {
    this.dialect = dialect;
    this.hostInfoBuilder = hostInfoBuilder;
  }

  /**
   * Query the database for information for each instance in the database topology.
   *
   * @param targetClient the client wrapper to use to query the database.
   * @param dialect the database dialect to use for the topology query.
   * @param clusterInstanceTemplate the template {@link HostInfo} to use when constructing new {@link HostInfo} objects from
   *                                the data returned by the topology query.
   * @returns a list of {@link HostInfo} objects representing the results of the topology query.
   * @throws TypeError if the dialect is not topology-aware.
   */
  async queryForTopology(
    targetClient: ClientWrapper,
    dialect: DatabaseDialect,
    initialHost: HostInfo,
    clusterInstanceTemplate: HostInfo
  ): Promise<HostInfo[]> {
    if (!isDialectTopologyAware(dialect)) {
      throw new TypeError(Messages.get("RdsHostListProvider.incorrectDialect"));
    }

    return await dialect
      .queryForTopology(targetClient)
      .then((res: TopologyQueryResult[]) => this.verifyWriter(this.createHosts(res, initialHost, clusterInstanceTemplate)));
  }

  public createHost(
    instanceId: string | undefined,
    instanceName: string | undefined,
    isWriter: boolean,
    weight: number,
    lastUpdateTime: number,
    initialHost: HostInfo,
    instanceTemplate: HostInfo,
    endpoint?: string,
    port?: number
  ): HostInfo {
    const hostname = !instanceName ? "?" : instanceName;
    const finalInstanceId = instanceId ?? hostname;

    if (!finalInstanceId) {
      throw new AwsWrapperError(Messages.get("TopologyUtils.instanceIdRequired"));
    }

    const finalEndpoint = endpoint ?? this.getHostEndpoint(hostname, instanceTemplate) ?? "";

    const finalPort = port ?? (instanceTemplate?.isPortSpecified() ? instanceTemplate?.port : initialHost?.port);

    const host: HostInfo = this.hostInfoBuilder
      .withHost(finalEndpoint)
      .withPort(finalPort ?? HostInfo.NO_PORT)
      .withRole(isWriter ? HostRole.WRITER : HostRole.READER)
      .withAvailability(HostAvailability.AVAILABLE)
      .withWeight(weight)
      .withLastUpdateTime(lastUpdateTime)
      .withHostId(finalInstanceId)
      .build();
    host.addAlias(finalEndpoint);
    return host;
  }

  /**
   * Creates {@link HostInfo} objects from the given topology query results.
   *
   * @param topologyQueryResults the result set returned by the topology query describing the cluster topology
   * @param initialHost the {@link HostInfo} describing the initial connection.
   * @param clusterInstanceTemplate the template used to construct the new {@link HostInfo} objects.
   * @returns a list of {@link HostInfo} objects representing the topology.
   */
  public createHosts(topologyQueryResults: TopologyQueryResult[], initialHost: HostInfo, clusterInstanceTemplate: HostInfo): HostInfo[] {
    const hostsMap = new Map<string, HostInfo>();
    topologyQueryResults.forEach((row) => {
      const lastUpdateTime = row.lastUpdateTime ?? Date.now();

      const host = this.createHost(
        row.id,
        row.host,
        row.isWriter,
        row.weight,
        lastUpdateTime,
        initialHost,
        clusterInstanceTemplate,
        row.endpoint,
        row.port
      );

      const existing = hostsMap.get(host.host);
      if (!existing || existing.lastUpdateTime < host.lastUpdateTime) {
        hostsMap.set(host.host, host);
      }
    });

    return Array.from(hostsMap.values());
  }

  /**
   * Gets the host endpoint by replacing the placeholder in the cluster instance template.
   *
   * @param hostName the host name to use in the endpoint.
   * @param clusterInstanceTemplate the template containing the endpoint pattern.
   * @returns the constructed endpoint, or null if the template is invalid.
   */
  protected getHostEndpoint(hostName: string, clusterInstanceTemplate: HostInfo): string | null {
    if (!clusterInstanceTemplate || !clusterInstanceTemplate.host) {
      return null;
    }
    const host = clusterInstanceTemplate.host;
    return host.replace("?", hostName);
  }

  /**
   * Verifies that the topology contains exactly one writer instance.
   * If multiple writers are found, selects the most recently updated one.
   *
   * @param allHosts the list of all hosts from the topology query.
   * @returns the verified list of hosts with exactly one writer, or null if no writer is found.
   */
  protected async verifyWriter(allHosts: HostInfo[]): Promise<HostInfo[]> {
    if (allHosts === null || allHosts.length === 0) {
      return null;
    }

    const hosts: HostInfo[] = [];
    const writers: HostInfo[] = [];

    for (const host of allHosts) {
      if (host.role === HostRole.WRITER) {
        writers.push(host);
      } else {
        hosts.push(host);
      }
    }

    const writerCount = writers.length;
    if (writerCount === 0) {
      return null;
    } else if (writerCount === 1) {
      hosts.push(writers[0]);
    } else {
      // Assume the latest updated writer instance is the current writer. Other potential writers will be ignored.
      const sortedWriters: HostInfo[] = writers.sort((a, b) => {
        return b.lastUpdateTime - a.lastUpdateTime; // reverse order
      });
      hosts.push(sortedWriters[0]);
    }

    return hosts;
  }

  /**
   * Identifies instances across different database types using instanceId and instanceName values.
   *
   * Database types handle these identifiers differently:
   * - Aurora: Uses the instance name as both instanceId and instanceName
   *   Example: "test-instance-1" for both values
   * - RDS Cluster: Uses distinct values for instanceId and instanceName
   *   Example:
   *     instanceId: "db-WQFQKBTL2LQUPIEFIFBGENS4ZQ"
   *     instanceName: "test-multiaz-instance-1"
   *
   * @param client the client wrapper to query.
   * @returns a tuple of [instanceId, instanceName], or null if the query fails.
   */
  getInstanceId(client: ClientWrapper): Promise<[string, string]> {
    return this.dialect.getInstanceId(client);
  }

  /**
   * Evaluate whether the given connection is to a writer instance.
   *
   * @param client the client wrapper to evaluate.
   * @returns true if the connection is to a writer instance, false otherwise.
   * @throws Error if an exception occurs when querying the database or processing the database response.
   */
  async isWriterInstance(client: ClientWrapper): Promise<boolean> {
    return (await this.dialect.getWriterId(client)) != null;
  }

  /**
   * Evaluate the database role of the given connection, either {@link HostRole.WRITER} or {@link HostRole.READER}.
   *
   * @param client the client wrapper to evaluate.
   * @returns the database role of the given connection.
   * @throws Error if an exception occurs when querying the database or processing the database response.
   */
  async getHostRole(client: ClientWrapper): Promise<HostRole> {
    try {
      return await this.dialect.getHostRole(client);
    } catch (error: any) {
      throw new AwsWrapperError(Messages.get("TopologyUtils.errorGettingHostRole"));
    }
  }
}
