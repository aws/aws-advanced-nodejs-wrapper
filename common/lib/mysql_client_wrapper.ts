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

import { ClientWrapper } from "./client_wrapper";
import { HostInfo } from "./host_info";
import { ClientUtils } from "./utils/client_utils";
import { uniqueId } from "../logutils";
import { DriverDialect } from "./driver_dialect/driver_dialect";

/*
This is an internal wrapper class for the target community driver client created by the MySQL2DriverDialect.
 */
export class MySQLClientWrapper implements ClientWrapper {
  private readonly driverDialect: DriverDialect;
  readonly client: any;
  readonly hostInfo: HostInfo;
  readonly properties: Map<string, string>;
  readonly id: string;

  /**
   * Creates a wrapper for the target community driver client.
   *
   * @param targetClient The community driver client created for an instance.
   * @param hostInfo Host information for the connected instance.
   * @param properties Connection properties for the target client.
   * @param driverDialect The driver dialect to obtain driver-specific information.
   */
  constructor(targetClient: any, hostInfo: HostInfo, properties: Map<string, any>, driverDialect: DriverDialect) {
    this.client = targetClient;
    this.hostInfo = hostInfo;
    this.properties = properties;
    this.driverDialect = driverDialect;
    this.id = uniqueId("MySQLClient_");
  }

  query(sql: any): Promise<any> {
    this.driverDialect.setQueryTimeout(this.properties, sql);
    return this.client?.query(sql);
  }

  async queryWithTimeout(sql: string): Promise<any> {
    return await ClientUtils.queryWithTimeout(this.client.query({ sql: sql }), this.properties);
  }

  end(): Promise<void> {
    return this.client?.end();
  }

  rollback(): Promise<void> {
    return this.client?.rollback();
  }

  async abort(): Promise<void> {
    try {
      return await ClientUtils.queryWithTimeout(this.client?.destroy(), this.properties);
    } catch (error: any) {
      // ignore
    }
  }
}
