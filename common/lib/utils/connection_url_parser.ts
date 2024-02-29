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

import { RdsUtils } from "./rds_utils";
import { HostRole } from "../host_role";
import { HostInfoBuilder } from "../host_info_builder";
import { RdsUrlType } from "./rds_url_type";
import { HostInfo } from "../host_info";

export abstract class ConnectionUrlParser {
  protected static readonly HOST_SEPARATOR = ",";
  private static readonly HOST_PORT_SEPARATOR = ":";
  private static readonly rdsUtils: RdsUtils = new RdsUtils();

  /**
   * Returns the
   * @param initialConnection
   */
  abstract getHostPortPairsFromUrl(initialConnection: string): string[];

  private getHostInfo(host: string, port: string | undefined, role: HostRole, builder: HostInfoBuilder): HostInfo {
    const hostId = ConnectionUrlParser.rdsUtils.getRdsInstanceId(host);

    builder = builder.withHost(host).withRole(role);

    if (hostId) {
      builder.withHostId(hostId);
    }

    return builder.withPort(port ? parseInt(port) : -1).build();
  }

  private parseHostPortPair(pair: string, hostInfoBuilderFunc: () => HostInfoBuilder): HostInfo;
  private parseHostPortPair(pair: string, hostInfoBuilderFunc: () => HostInfoBuilder, role: HostRole): HostInfo;
  private parseHostPortPair(pair: string, hostInfoBuilderFunc: () => HostInfoBuilder, role?: HostRole): HostInfo {
    const [host, port] = pair.trim().split(ConnectionUrlParser.HOST_PORT_SEPARATOR);
    if (role) {
      return this.getHostInfo(host, port, role, hostInfoBuilderFunc());
    }

    const hostType = ConnectionUrlParser.rdsUtils.identifyRdsType(host);

    // Assign HostRole of READER if using the reader cluster URL, otherwise assume a HostRole of WRITER
    const hostRole: HostRole = RdsUrlType.RDS_READER_CLUSTER == hostType ? HostRole.READER : HostRole.WRITER;
    return this.getHostInfo(host, port, hostRole, hostInfoBuilderFunc());
  }

  getHostsFromConnectionUrl(initialConnection: string, singleWriterConnectionString: boolean, builderFunc: () => HostInfoBuilder): HostInfo[] {
    const hostsList: HostInfo[] = [];
    const hosts: string[] = this.getHostPortPairsFromUrl(initialConnection);
    hosts.forEach((pair, i) => {
      let host;
      if (singleWriterConnectionString) {
        const role: HostRole = i > 0 ? HostRole.READER : HostRole.WRITER;
        host = this.parseHostPortPair(pair, builderFunc, role);
      } else {
        host = this.parseHostPortPair(pair, builderFunc);
      }

      if (host.host) {
        hostsList.push(host);
      }
    });

    return hostsList;
  }
}
