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

import { CustomEndpointRoleType, customEndpointRoleTypeFromValue } from "./custom_endpoint_role_type";
import { MemberListType } from "./member_list_type";
import { DBClusterEndpoint } from "@aws-sdk/client-rds";

export class CustomEndpointInfo {
  private readonly endpointIdentifier: string; // ID portion of the custom endpoint URL.
  private readonly clusterIdentifier: string; // ID of the cluster that the custom endpoint belongs to.
  private readonly url: string;
  private readonly roleType: CustomEndpointRoleType;

  // A given custom endpoint will either specify a static list or an exclusion list, as indicated by `memberListType`.
  // If the list is a static list, 'members' specifies instances included in the custom endpoint, and new cluster
  // instances will not be automatically added to the custom endpoint. If it is an exclusion list, 'members' specifies
  // instances excluded by the custom endpoint, and new cluster instances will be added to the custom endpoint.
  private readonly memberListType: MemberListType;
  private readonly members: Set<string>;

  constructor(
    endpointIdentifier: string,
    clusterIdentifier: string,
    url: string,
    roleType: CustomEndpointRoleType,
    members: Set<string>,
    memberListType: MemberListType
  ) {
    this.endpointIdentifier = endpointIdentifier;
    this.clusterIdentifier = clusterIdentifier;
    this.url = url;
    this.roleType = roleType;
    this.members = members;
    this.memberListType = memberListType;
  }

  getMemberListType(): MemberListType {
    return this.memberListType;
  }

  static fromDbClusterEndpoint(responseEndpointInfo: DBClusterEndpoint): CustomEndpointInfo {
    let members: Set<string>;
    let memberListType: MemberListType;

    if (responseEndpointInfo.StaticMembers) {
      members = new Set(responseEndpointInfo.StaticMembers);
      memberListType = MemberListType.STATIC_LIST;
    } else {
      members = new Set(responseEndpointInfo.ExcludedMembers);
      memberListType = MemberListType.EXCLUSION_LIST;
    }

    return new CustomEndpointInfo(
      responseEndpointInfo.DBClusterEndpointIdentifier,
      responseEndpointInfo.DBClusterIdentifier,
      responseEndpointInfo.Endpoint,
      customEndpointRoleTypeFromValue(responseEndpointInfo.CustomEndpointType),
      members,
      memberListType
    );
  }

  getStaticMembers(): Set<string> {
    return this.memberListType === MemberListType.STATIC_LIST ? this.members : new Set();
  }

  getExcludedMembers(): Set<string> {
    return this.memberListType === MemberListType.EXCLUSION_LIST ? this.members : new Set();
  }

  equals(info: CustomEndpointInfo): boolean {
    if (!info) {
      return false;
    }

    if (info === this) {
      return true;
    }

    return (
      this.endpointIdentifier === info.endpointIdentifier &&
      this.clusterIdentifier === info.clusterIdentifier &&
      this.url === info.url &&
      this.roleType === info.roleType &&
      this.members === info.members &&
      this.memberListType === info.memberListType
    );
  }

  toString(): string {
    return `CustomEndpointInfo[url=${this.url}, clusterIdentifier=${this.clusterIdentifier}, customEndpointType=${CustomEndpointRoleType[this.roleType]}, memberListType=${MemberListType[this.memberListType]}, members={${[...this.members].join(", ")}}]`;
  }
}
