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

import { RegionUtils } from "./region_utils";
import { HostInfo } from "../host_info";
import { AwsCredentialsManager } from "../authentication/aws_credentials_manager";
import { DescribeGlobalClustersCommand, GlobalCluster, GlobalClusterMember, RDSClient } from "@aws-sdk/client-rds";
import { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types/dist-types/identity/awsCredentialIdentity";

export class GDBRegionUtils extends RegionUtils {
  private static readonly GDB_CLUSTER_ARN_PATTERN = /^arn:aws:rds:(?<region>[^:\n]*):([^:\n]*):([^:/\n]*[:/])?(.*)$/;
  private static readonly REGION_GROUP = "region";
  private credentialsProvider: AwsCredentialIdentity | AwsCredentialIdentityProvider | undefined;

  constructor(credentialsProvider?: AwsCredentialIdentity | AwsCredentialIdentityProvider) {
    super();
    this.credentialsProvider = credentialsProvider;
  }

  async getRegion(regionKey: string, hostInfo?: HostInfo, props?: Map<string, any>): Promise<string | null> {
    if (props.get(regionKey)) {
      return super.getRegion(props.get(regionKey), hostInfo);
    }

    if (!hostInfo || !props) {
      return null;
    }

    const clusterId = GDBRegionUtils.rdsUtils.getRdsClusterId(hostInfo.host);
    if (!clusterId) {
      return null;
    }

    const writerClusterArn = await this.findWriterClusterArn(hostInfo, props, clusterId);
    return writerClusterArn ? this.getRegionFromClusterArn(writerClusterArn) : null;
  }

  private async findWriterClusterArn(hostInfo: HostInfo, props: Map<string, any>, globalClusterIdentifier: string): Promise<string | null> {
    if (this.credentialsProvider != null) {
      this.credentialsProvider = AwsCredentialsManager.getProvider(hostInfo, props);
    }

    const rdsClient = this.getRdsClient();

    try {
      const command = new DescribeGlobalClustersCommand({
        GlobalClusterIdentifier: globalClusterIdentifier
      });

      const response = await rdsClient.send(command);
      return this.extractWriterClusterArn(response.GlobalClusters);
    } finally {
      rdsClient.destroy();
    }
  }

  private extractWriterClusterArn(globalClusters?: GlobalCluster[]): string | null {
    if (!globalClusters) {
      return null;
    }

    for (const cluster of globalClusters) {
      const writerArn = this.findWriterMemberArn(cluster.GlobalClusterMembers);
      if (writerArn) {
        return writerArn;
      }
    }

    return null;
  }

  private findWriterMemberArn(members?: GlobalClusterMember[]): string | null {
    if (!members) {
      return null;
    }

    const writerMember = members.find((member) => member.IsWriter);
    return writerMember?.DBClusterArn ?? null;
  }

  private getRegionFromClusterArn(clusterArn: string): string | null {
    const match = clusterArn.match(GDBRegionUtils.GDB_CLUSTER_ARN_PATTERN);
    return match?.groups?.[GDBRegionUtils.REGION_GROUP] ?? null;
  }

  private getRdsClient(): RDSClient {
    return new RDSClient({ credentials: this.credentialsProvider });
  }
}
