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

import {
  BlueGreenDeployment,
  CreateDBInstanceCommand,
  DBCluster,
  DBInstanceAlreadyExistsFault,
  DBInstanceNotFoundFault,
  DeleteDBInstanceCommand,
  DescribeBlueGreenDeploymentsCommand,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  FailoverDBClusterCommand,
  InvalidDBInstanceStateFault,
  RDSClient,
  RebootDBInstanceCommand,
  SwitchoverBlueGreenDeploymentCommand,
  SwitchoverBlueGreenDeploymentResponse
} from "@aws-sdk/client-rds";
import { TestEnvironment } from "./test_environment";
import * as dns from "dns";
import { DBInstance } from "@aws-sdk/client-rds/dist-types/models/models_0";
import { AwsClient } from "../../../../../common/lib/aws_client";
import { DriverHelper } from "./driver_helper";
import { sleep } from "../../../../../common/lib/utils/utils";
import { logger } from "../../../../../common/logutils";
import { TestInstanceInfo } from "./test_instance_info";
import { TestEnvironmentInfo } from "./test_environment_info";
import { DatabaseEngine } from "./database_engine";
import { DatabaseEngineDeployment } from "./database_engine_deployment";

const instanceClass: string = "db.r5.large";

export class AuroraTestUtility {
  private client: RDSClient;

  constructor(region: string = "us-east-1", endpoint: string = null) {
    this.client =
      endpoint === null
        ? new RDSClient({ region: region })
        : new RDSClient({
            region: region,
            endpoint: endpoint
          });
  }

  async getDbInstance(instanceId: string): Promise<DBInstance | null> {
    const input = {
      DBInstanceIdentifier: instanceId,
      Filters: [
        {
          Name: "db-instance-id",
          Values: [instanceId]
        }
      ]
    };
    const command = new DescribeDBInstancesCommand(input);
    const res = await this.client.send(command);
    const instances = res.DBInstances;
    if (instances === undefined) {
      return null;
    }
    return instances[0];
  }

  async waitUntilInstanceHasRightState(instanceId: string, ...allowedStatuses: string[]) {
    let instanceInfo = await this.getDbInstance(instanceId);
    if (instanceInfo === null) {
      throw new Error("invalid instance");
    }
    let status = instanceInfo["DBInstanceStatus"];
    const waitTilTime: number = Date.now() + 15 * 60 * 1000; // 15 minutes
    while (status && !allowedStatuses.includes(status.toLowerCase()) && waitTilTime > Date.now()) {
      await sleep(5000);
      try {
        instanceInfo = await this.getDbInstance(instanceId);
        if (instanceInfo !== null) {
          status = instanceInfo["DBInstanceStatus"];
          logger.info(`Instance ${instanceId} status: ${status.toLowerCase()}`);
        }
      } catch (e: any) {
        if (e instanceof DBInstanceNotFoundFault) {
          // Wait for instance to be created.
        }
      }
    }

    if (!allowedStatuses.includes(status.toLowerCase())) {
      throw new Error(`Instance ${instanceId} status is still ${status.toLowerCase()}`);
    }
    logger.info(`Instance ${instanceId} status: ${status.toLowerCase()}`);
  }

  async getRdsInstanceIds(engine: DatabaseEngine, deployment: DatabaseEngineDeployment, client: any) {
    let retrieveTopologySql: string;
    switch (deployment) {
      case DatabaseEngineDeployment.AURORA:
        switch (engine) {
          case DatabaseEngine.MYSQL:
            retrieveTopologySql =
              "SELECT SERVER_ID, SESSION_ID FROM information_schema.replica_host_status ORDER BY IF(SESSION_ID = 'MASTER_SESSION_ID', 0, 1)";
            break;
          case DatabaseEngine.PG:
            retrieveTopologySql =
              "SELECT SERVER_ID, SESSION_ID FROM aurora_replica_status() ORDER BY CASE WHEN SESSION_ID = 'MASTER_SESSION_ID' THEN 0 ELSE 1 END";
            break;
          default:
            throw new Error(`Unsupported database engine: ${engine}`);
        }
        break;
      case DatabaseEngineDeployment.RDS_MULTI_AZ_CLUSTER:
        switch (engine) {
          case DatabaseEngine.MYSQL: {
            const replicaWriterId: string = await this.getMultiAzMysqlReplicaWriterInstanceId(client);
            retrieveTopologySql = `SELECT SUBSTRING_INDEX(endpoint, '.', 1) as SERVER_ID
                                   FROM mysql.rds_topology
                                   ORDER BY CASE WHEN id = ${replicaWriterId == null ? "@@server_id" : `'${replicaWriterId}'`} THEN 0 ELSE 1 END,
                                            SUBSTRING_INDEX(endpoint, '.', 1)`;
            break;
          }
          case DatabaseEngine.PG:
            retrieveTopologySql =
              "SELECT SUBSTRING(endpoint FROM 0 FOR POSITION('.' IN endpoint)) as SERVER_ID FROM rds_tools.show_topology() ORDER BY CASE WHEN id = (SELECT MAX(multi_az_db_cluster_source_dbi_resource_id) FROM rds_tools.multi_az_db_cluster_source_dbi_resource_id()) THEN 0 ELSE 1 END, endpoint";

            break;
          default:
            throw new Error(`Unsupported database engine: ${engine}`);
        }
        break;
      case DatabaseEngineDeployment.RDS_MULTI_AZ_INSTANCE:
        switch (engine) {
          case DatabaseEngine.MYSQL:
            retrieveTopologySql = "SELECT SUBSTRING_INDEX(endpoint, '.', 1) as SERVER_ID FROM mysql.rds_topology";
            break;
          case DatabaseEngine.PG:
            retrieveTopologySql = "SELECT SUBSTRING(endpoint FROM 0 FOR POSITION('.' IN endpoint)) as SERVER_ID" + " FROM rds_tools.show_topology()";

            break;
          default:
            throw new Error(`Unsupported database engine: ${engine}`);
        }
        break;
      default:
        throw new Error(`Unsupported database engine deployment: ${deployment}`);
    }

    const auroraInstances: string[] = [];
    const result = await client.query(retrieveTopologySql);
    switch (engine) {
      case DatabaseEngine.MYSQL:
        for (const row of result[0]) {
          auroraInstances.push(row.SERVER_ID);
        }
        break;
      case DatabaseEngine.PG:
        for (const row of result.rows) {
          auroraInstances.push(row.server_id);
        }
        break;
      default:
        throw new Error(`Unsupported database engine: ${engine}`);
    }
    return auroraInstances;
  }

  private async getMultiAzMysqlReplicaWriterInstanceId(client: any): Promise<string | null> {
    const result = await client.query("SHOW REPLICA STATUS");
    if (result.length > 0) {
      return result[0].Source_Server_id;
    }
    return null;
  }

  async waitUntilClusterHasDesiredStatus(clusterId: string, desiredStatus: string = "available") {
    let clusterInfo = await this.getDbCluster(clusterId);
    if (clusterInfo === null) {
      throw new Error("invalid cluster");
    }
    let status = clusterInfo["Status"];
    while (status !== desiredStatus) {
      await sleep(1000);
      clusterInfo = await this.getDbCluster(clusterId);
      if (clusterInfo !== null) {
        status = clusterInfo["Status"];
      }
    }
  }

  async rebootInstance(instanceId: string) {
    let attempts = 5;
    while (attempts-- > 0) {
      try {
        const command = new RebootDBInstanceCommand({
          DBInstanceIdentifier: instanceId
        });
        await this.client.send(command);
      } catch (error: any) {
        logger.debug(`rebootDbInstance ${instanceId} failed: ${error.message}`);
        await sleep(1000);
      }
    }
  }

  async getDbCluster(clusterId: string) {
    const command = new DescribeDBClustersCommand({
      DBClusterIdentifier: clusterId
    });
    const clusters = (await this.client.send(command)).DBClusters;
    if (clusters === undefined) {
      return null;
    }

    return clusters[0];
  }

  async failoverClusterAndWaitUntilWriterChanged(initialWriter?: string, clusterId?: string, targetWriterId?: string) {
    if (this.isNullOrUndefined(clusterId)) {
      clusterId = (await TestEnvironment.getCurrent()).info.rdsDbName;
    }

    if (this.isNullOrUndefined(initialWriter)) {
      initialWriter = await this.getClusterWriterInstanceId(clusterId);
    }

    const databaseInfo = (await TestEnvironment.getCurrent()).databaseInfo;
    const clusterEndpoint = databaseInfo.clusterEndpoint;
    const initialClusterAddress = await dns.promises.lookup(clusterEndpoint);

    await this.failoverClusterToTarget(clusterId, targetWriterId);

    let remainingAttempts: number = 5;
    while (!(await this.writerChanged(initialWriter, clusterId, 300))) {
      remainingAttempts -= 1;
      if (remainingAttempts === 0) {
        throw new Error("failover request unsuccessful");
      }

      await this.failoverClusterToTarget(clusterId, targetWriterId);
    }

    let clusterAddress: dns.LookupAddress = await dns.promises.lookup(clusterEndpoint);
    while (clusterAddress === initialClusterAddress) {
      await sleep(1000);
      clusterAddress = await dns.promises.lookup(clusterEndpoint);
    }
  }

  async failoverClusterToTarget(clusterId?: string, targetInstanceId?: string): Promise<void> {
    const info = (await TestEnvironment.getCurrent()).info;
    if (clusterId == null) {
      clusterId = info.rdsDbName;
    }

    await this.waitUntilClusterHasDesiredStatus(clusterId);

    const input: any = {
      DBClusterIdentifier: clusterId
    };
    if (targetInstanceId) {
      input.TargetDBInstanceIdentifier = targetInstanceId;
    }

    let remainingAttempts = 10;
    const command = new FailoverDBClusterCommand(input);
    const auroraUtility = new AuroraTestUtility(info.region);
    while (remainingAttempts-- > 0) {
      try {
        const result = await this.client.send(command);
        if (!this.isNullOrUndefined(result["DBCluster"])) {
          await auroraUtility.waitUntilClusterHasDesiredStatus(clusterId);
          info.databaseInfo.moveInstanceFirst(await auroraUtility.getClusterWriterInstanceId(clusterId));
          info.proxyDatabaseInfo.moveInstanceFirst(await auroraUtility.getClusterWriterInstanceId(clusterId));
          return;
        }

        await sleep(1000);
      } catch (e) {
        await sleep(1);
      }
    }
  }

  async writerChanged(initialWriter?: string, clusterId?: string, timeout: number = 15) {
    const current = new Date();
    const stopTime = current.setMinutes(current.getMinutes() + timeout * 60);

    let currentWriterId = await this.getClusterWriterInstanceId(clusterId);

    while (initialWriter === currentWriterId && new Date().getTime() < stopTime) {
      await sleep(3000);
      currentWriterId = await this.getClusterWriterInstanceId(clusterId);
    }

    return initialWriter !== currentWriterId;
  }

  async queryInstanceId(client: AwsClient) {
    const testEnvironment: TestEnvironment = await TestEnvironment.getCurrent();
    return await DriverHelper.executeInstanceQuery(testEnvironment.engine, testEnvironment.deployment, client);
  }

  async queryInstanceIdWithSleep(client: AwsClient) {
    const testEnvironment: TestEnvironment = await TestEnvironment.getCurrent();
    return await DriverHelper.executeInstanceQueryWithSleep(testEnvironment.engine, testEnvironment.deployment, client);
  }

  async isDbInstanceWriter(instanceId: string, clusterId?: string) {
    if (clusterId === undefined) {
      clusterId = (await TestEnvironment.getCurrent()).info.rdsDbName;
    }
    const clusterInfo = await this.getDbCluster(clusterId);
    if (clusterInfo === null || clusterInfo.DBClusterMembers === undefined) {
      throw new Error("invalid cluster");
    }
    const members = clusterInfo.DBClusterMembers;

    const instance = members.find((m) => m.DBInstanceIdentifier === instanceId);
    if (instance === undefined) {
      throw new Error("cant find instance");
    }

    return instance.IsClusterWriter;
  }

  async getClusterWriterInstanceId(clusterId?: string) {
    if (clusterId === undefined) {
      clusterId = (await TestEnvironment.getCurrent()).info.rdsDbName;
    }

    const clusterInfo = await this.getDbCluster(clusterId);
    if (clusterInfo === null || clusterInfo.DBClusterMembers === undefined) {
      throw new Error("invalid cluster");
    }
    const members = clusterInfo.DBClusterMembers;

    const instance = members.find((m) => m.IsClusterWriter);
    if (instance === undefined || instance.DBInstanceIdentifier === undefined) {
      throw new Error("cant find writer");
    }

    return instance.DBInstanceIdentifier;
  }

  isNullOrUndefined(value: any): boolean {
    return value === undefined || value === null;
  }

  async createInstance(instanceId: string): Promise<TestInstanceInfo> {
    const info: TestEnvironmentInfo = (await TestEnvironment.getCurrent()).info;
    const command = new CreateDBInstanceCommand({
      DBInstanceIdentifier: instanceId,
      DBClusterIdentifier: info.rdsDbName,
      DBInstanceClass: instanceClass,
      PubliclyAccessible: true,
      Engine: info.databaseEngine,
      EngineVersion: info.databaseEngineVersion
    });
    try {
      await this.client.send(command);
    } catch (e: any) {
      if (!(e instanceof DBInstanceAlreadyExistsFault)) {
        throw new Error(`The CreateDBInstanceCommand request for ${instanceId} failed: ${e.message}`);
      }
    }
    await this.waitUntilInstanceHasRightState(
      instanceId,
      "available",
      "storage-optimization",
      "incompatible-credentials",
      "incompatible-parameters",
      "unavailable"
    );
    const instance: DBInstance | null = await this.getDbInstance(instanceId);
    const host = instance?.Endpoint?.Address
      ? instance.Endpoint.Address
      : instanceId.concat(info.databaseInfo.writerInstanceEndpoint.slice(info.databaseInfo.writerInstanceEndpoint.indexOf(".")));
    const port = instance?.Endpoint?.Port ? instance.Endpoint.Port : info.databaseInfo.instanceEndpointPort;
    return new TestInstanceInfo({ instanceId: instanceId, host: host, port: port });
  }

  async deleteInstance(instanceId: string) {
    // assure that instance exists, if it does not return
    if (!instanceId || !(await this.instanceExists(instanceId))) {
      return;
    }

    // set up stop time
    const current = Date.now();
    const stopTime = current + 15 * 60 * 1000;

    // create and send command to delete
    try {
      const command = new DeleteDBInstanceCommand({
        DBInstanceIdentifier: instanceId,
        SkipFinalSnapshot: true
      });
      await this.client.send(command);
    } catch (e: any) {
      if (e instanceof InvalidDBInstanceStateFault) {
        // Instance is already being deleted.
      } else {
        throw e;
      }
    }

    // wait for it to delete
    while ((await this.instanceExists(instanceId)) && Date.now() < stopTime) {
      await sleep(5000);
    }

    if (await this.instanceExists(instanceId)) {
      throw new Error(`The instance ${instanceId} was not deleted within the allotted time.`);
    }
  }

  async instanceExists(instanceId: string): Promise<boolean> {
    try {
      const instance = await this.getDbInstance(instanceId);
      return !!instance;
    } catch (error) {
      return false;
    }
  }

  async getNumberOfInstances(): Promise<number> {
    const command = new DescribeDBInstancesCommand();
    const instances: DBInstance[] | undefined = (await this.client.send(command)).DBInstances;
    if (!instances) {
      return 0;
    }
    return instances.length;
  }

  async getClusterByArn(clusterArn: string): Promise<DBCluster | null> {
    const command = new DescribeDBClustersCommand({
      DBClusterIdentifier: clusterArn
    });
    const clusters: DBCluster[] | undefined = (await this.client.send(command)).DBClusters;
    if (!clusters) {
      return null;
    }
    return clusters[0];
  }

  async getRdsInstanceInfoByArn(instanceArn: string): Promise<DBInstance | null> {
    const command = new DescribeDBInstancesCommand({
      DBInstanceIdentifier: instanceArn
    });
    const instances: DBInstance[] | undefined = (await this.client.send(command)).DBInstances;
    if (!instances) {
      return null;
    }
    return instances[0];
  }

  async getBlueGreenDeployment(blueGreenId: string): Promise<BlueGreenDeployment | null> {
    const command = new DescribeBlueGreenDeploymentsCommand({
      BlueGreenDeploymentIdentifier: blueGreenId
    });
    try {
      const blueGreenDeployments = (await this.client.send(command)).BlueGreenDeployments;
      if (blueGreenDeployments === undefined || blueGreenDeployments.length === 0) {
        return null;
      }

      return blueGreenDeployments[0];
    } catch {
      return null;
    }
  }

  async switchoverBlueGreenDeployment(blueGreenId: string) {
    const command = new SwitchoverBlueGreenDeploymentCommand({
      BlueGreenDeploymentIdentifier: blueGreenId
    });
    const response: SwitchoverBlueGreenDeploymentResponse = await this.client.send(command);
    if (response.BlueGreenDeployment !== undefined) {
      logger.debug("switchoverBlueGreenDeployment request is sent.");
    }
  }
}
