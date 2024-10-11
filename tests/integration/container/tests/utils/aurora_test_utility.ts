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
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  FailoverDBClusterCommand,
  RDSClient,
  RebootDBInstanceCommand
} from "@aws-sdk/client-rds";
import { TestEnvironment } from "./test_environment";
import * as dns from "dns";
import { DBInstance } from "@aws-sdk/client-rds/dist-types/models/models_0";
import { AwsClient } from "../../../../../common/lib/aws_client";
import { DriverHelper } from "./driver_helper";
import { sleep } from "../../../../../common/lib/utils/utils";
import { logger } from "../../../../../common/logutils";

export class AuroraTestUtility {
  private client: RDSClient;

  constructor(region: string = "us-east-1") {
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

  async waitUntilInstanceHasRightState(instanceId: string, ...allowedStatuses: string[]) {
    let instanceInfo = await this.getDbInstance(instanceId);
    if (instanceInfo === null) {
      throw new Error("invalid instance");
    }
    let status = instanceInfo["DBInstanceStatus"];
    const waitTilTime: number = Date.now() + 15 * 60 * 1000; // 15 minutes
    while (status && !allowedStatuses.includes(status.toLowerCase()) && waitTilTime > Date.now()) {
      await sleep(1000);
      instanceInfo = await this.getDbInstance(instanceId);
      if (instanceInfo !== null) {
        status = instanceInfo["DBInstanceStatus"];
      }
    }
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
      await sleep(1000);
      clusterAddress = await dns.promises.lookup(clusterEndpoint);
    }
  }

  async failoverCluster(clusterId?: string) {
    const info = (await TestEnvironment.getCurrent()).info;
    if (clusterId == null) {
      clusterId = info.auroraClusterName;
    }

    await this.waitUntilClusterHasDesiredStatus(clusterId);

    let remainingAttempts = 10;
    const command = new FailoverDBClusterCommand({
      DBClusterIdentifier: clusterId
    });
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
    if (instance === undefined || instance.DBInstanceIdentifier === undefined) {
      throw new Error("cant find writer");
    }

    return instance.DBInstanceIdentifier;
  }

  isNullOrUndefined(value: any): boolean {
    return value === undefined || value === null;
  }
}
