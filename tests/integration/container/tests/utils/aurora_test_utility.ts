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
  CreateDBClusterCommand,
  DeleteDBInstanceCommand,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  FailoverDBClusterCommand,
  RDSClient
} from "@aws-sdk/client-rds";
import { TestInstanceInfo } from "./test_instance_info";
import { TestEnvironment } from "./test_environment";
import * as dns from "dns";
import { DBInstance } from "@aws-sdk/client-rds/dist-types/models/models_0";
import { DatabaseEngine } from "./database_engine";
import { FailoverSuccessError } from "aws-wrapper-common-lib/lib/utils/errors";
import { AwsClient } from "aws-wrapper-common-lib/lib/aws_client";
import { TopologyAwareDatabaseDialect } from "aws-wrapper-common-lib/lib/topology_aware_database_dialect";
import { DatabaseDialect } from "aws-wrapper-common-lib/lib/database_dialect";
import { DriverHelper } from "./driver_helper";

export class AuroraTestUtility {
  private client: RDSClient;

  constructor(region: string = "us-east-2") {
    this.client = new RDSClient({ region: region });
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

  async doesDbInstanceExists(instanceId: string) {
    try {
      const res = await this.getDbInstance(instanceId);
      return !this.isNullOrUndefined(res);
    } catch (err) {
      return false;
    }
  }

  async createDbInstance(instanceId: string): Promise<TestInstanceInfo> {
    const environment = await TestEnvironment.getCurrent();
    if (await this.doesDbInstanceExists(instanceId)) {
      await this.deleteDbInstance(instanceId);
    }

    const input = {
      DBClusterIdentifier: environment.info.auroraClusterName,
      DBInstanceIdentifier: instanceId,
      DBInstanceClass: "db.r5.large",
      Engine: this.getAuroraEngineName(environment.engine),
      PubliclyAccessible: true
    };
    const command = new CreateDBClusterCommand(input);
    await this.client.send(command);

    const instance = await this.waitUntilInstanceHasDesiredStatus(instanceId);
    if (instance == null) {
      throw new Error("failed to create instance");
    }

    return new TestInstanceInfo(instance);
  }

  async deleteDbInstance(instanceId: string) {
    const input = {
      DBInstanceIdentifier: instanceId
    };
    const command = new DeleteDBInstanceCommand(input);
    await this.client.send(command);
    await this.waitUntilInstanceHasDesiredStatus(instanceId, "deleted");
  }

  async waitUntilInstanceHasDesiredStatus(instanceId: string, desiredStatus: string = "available", waitTimeMins = 15) {
    const current = new Date();
    const stopTime = current.setMinutes(current.getMinutes() + waitTimeMins * 60);
    while (new Date().getTime() <= stopTime) {
      try {
        const instance = await this.getDbInstance(instanceId);
        if (!this.isNullOrUndefined(instance)) {
          return instance;
        }
      } catch (err: any) {
        if (err.name === "DBInstanceNotFoundFault" && desiredStatus === "deleted") {
          return null;
        }
      }

      this.sleep(1000);
    }

    throw new Error("instance description timed out");
  }

  async waitUntilClusterHasDesiredStatus(clusterId: string, desiredStatus: string = "available") {
    let clusterInfo = await this.getDbCluster(clusterId);
    if (clusterInfo === null) {
      throw new Error("invalid cluster");
    }
    let status = clusterInfo["Status"];
    while (status !== desiredStatus) {
      this.sleep(1000);
      clusterInfo = await this.getDbCluster(clusterId);
      if (clusterInfo !== null) {
        status = clusterInfo["Status"];
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

  async failoverClusterAndWaitUntilWriterChanged(initialWriter?: string, clusterId?: string) {
    if (this.isNullOrUndefined(clusterId)) {
      clusterId = (await TestEnvironment.getCurrent()).info.auroraClusterName;
    }

    if (this.isNullOrUndefined(initialWriter)) {
      initialWriter = await this.getClusterWriterInstanceId(clusterId);
    }

    const databaseInfo = (await TestEnvironment.getCurrent()).databaseInfo;
    const clusterEndpoint = databaseInfo.clusterEndpoint;
    const initialClusterAddress = await dns.promises.lookup(clusterEndpoint);

    await this.failoverCluster(clusterId);

    let remainingAttempts: number = 5;
    while (!(await this.writerChanged(initialWriter, clusterId, 300))) {
      remainingAttempts -= 1;
      if (remainingAttempts === 0) {
        throw new Error("failover request unsuccessful");
      }

      await this.failoverCluster(clusterId);
    }

    let clusterAddress: dns.LookupAddress = await dns.promises.lookup(clusterEndpoint);
    while (clusterAddress === initialClusterAddress) {
      this.sleep(1000);
      clusterAddress = await dns.promises.lookup(clusterEndpoint);
    }
  }

  async failoverCluster(clusterId?: string) {
    if (clusterId == null) {
      clusterId = (await TestEnvironment.getCurrent()).info.auroraClusterName;
    }

    await this.waitUntilClusterHasDesiredStatus(clusterId);

    const remainingAttempts = 10;
    const command = new FailoverDBClusterCommand({
      DBClusterIdentifier: clusterId
    });
    for (let i = remainingAttempts; i > 0; i--) {
      try {
        const result = await this.client.send(command);
        if (!this.isNullOrUndefined(result["DBCluster"])) {
          return;
        }

        this.sleep(1000);
      } catch (e) {
        this.sleep(1);
      }
    }
  }

  async writerChanged(initialWriter?: string, clusterId?: string, timeout: number = 15) {
    const current = new Date();
    const stopTime = current.setMinutes(current.getMinutes() + timeout * 60);

    let currentWriterId = await this.getClusterWriterInstanceId(clusterId);

    while (initialWriter === currentWriterId && new Date().getTime() < stopTime) {
      this.sleep(3000);
      currentWriterId = await this.getClusterWriterInstanceId(clusterId);
    }

    return initialWriter !== currentWriterId;
  }

  async queryInstanceId(client: AwsClient) {
    const engine = (await TestEnvironment.getCurrent()).engine;
    return await DriverHelper.executeInstanceQuery(engine, client);
  }

  async isDbInstanceWriter(instanceId: string, clusterId?: string) {
    if (clusterId === undefined) {
      clusterId = (await TestEnvironment.getCurrent()).info.auroraClusterName;
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
      clusterId = (await TestEnvironment.getCurrent()).info.auroraClusterName;
    }

    const clusterInfo = await this.getDbCluster(clusterId);
    if (clusterInfo === null || clusterInfo.DBClusterMembers === undefined) {
      throw new Error("invalid cluster");
    }
    const members = clusterInfo.DBClusterMembers;

    const instance = members.find((m) => m.IsClusterWriter);
    if (instance === undefined) {
      throw new Error("cant find writer");
    }

    return instance.DBInstanceIdentifier;
  }

  getAuroraEngineName(engine: DatabaseEngine) {
    switch (engine) {
      case DatabaseEngine.PG:
        return "aurora-postgresql";
      case DatabaseEngine.MYSQL:
        return "aurora-mysql";
      default:
        throw new Error("invalid engine");
    }
  }

  isNullOrUndefined(value: any): boolean {
    return value === undefined || value === null;
  }

  sleep(waitTime: number) {
    setTimeout(() => {}, waitTime);
  }
}
