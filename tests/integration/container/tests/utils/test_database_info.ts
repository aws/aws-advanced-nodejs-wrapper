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

import { TestInstanceInfo } from "./test_instance_info";
import { DBInstance } from "@aws-sdk/client-rds/dist-types/models/models_0";

export class TestDatabaseInfo {
  private readonly _username: string;
  private readonly _password: string;
  private readonly _defaultDbName: string;
  private readonly _clusterEndpoint: string;
  private readonly _clusterEndpointPort: number;
  private readonly _clusterReadOnlyEndpoint: string;
  private readonly _clusterReadOnlyEndpointPort: number;
  private readonly _instanceEndpointSuffix: string;
  private readonly _instanceEndpointPort: number;
  private readonly _instances: TestInstanceInfo[] = [];

  constructor(databaseInfo: { [s: string]: any }) {
    this._username = String(databaseInfo["username"]);
    this._password = String(databaseInfo["password"]);
    this._defaultDbName = String(databaseInfo["defaultDbName"]);
    this._clusterEndpoint = String(databaseInfo["clusterEndpoint"]);
    this._clusterEndpointPort = Number(databaseInfo["clusterEndpointPort"]);
    this._clusterReadOnlyEndpoint = String(databaseInfo["clusterReadOnlyEndpoint"]);
    this._clusterReadOnlyEndpointPort = Number(databaseInfo["clusterReadOnlyEndpointPort"]);
    this._instanceEndpointSuffix = String(databaseInfo["instanceEndpointSuffix"]);
    this._instanceEndpointPort = Number(databaseInfo["instanceEndpointPort"]);

    this._instances = Array.from(databaseInfo["instances"], (x: DBInstance) => {
      return new TestInstanceInfo(x);
    });
  }

  get username(): string {
    return this._username;
  }

  get password(): string {
    return this._password;
  }

  get defaultDbName(): string {
    return this._defaultDbName;
  }

  get writerInstanceEndpoint() {
    return this._instances[0].host ?? "";
  }

  get readerInstanceEndpoint() {
    return this._instances[1].host ?? "";
  }

  get writerInstanceId() {
    return this._instances[0].instanceId;
  }

  get clusterEndpoint(): string {
    return this._clusterEndpoint;
  }

  get clusterEndpointPort(): number {
    return this._clusterEndpointPort;
  }

  get clusterReadOnlyEndpoint(): string {
    return this._clusterReadOnlyEndpoint;
  }

  get clusterReadOnlyEndpointPort(): number {
    return this._clusterReadOnlyEndpointPort;
  }

  get instanceEndpointSuffix(): string {
    return this._instanceEndpointSuffix;
  }

  get instanceEndpointPort(): number {
    return this._instanceEndpointPort;
  }

  get instances(): TestInstanceInfo[] {
    return this._instances;
  }

  getInstance(instanceName: string): TestInstanceInfo {
    const instance = this._instances.find((instance) => instance.instanceId === instanceName);
    if (instance === undefined) {
      throw new Error("instance not found");
    }
    return instance;
  }

  moveInstanceFirst(instanceName: string) {
    const index = this._instances.findIndex((instance) => instance.instanceId == instanceName);
    this._instances.unshift(this._instances.splice(index, 1)[0]);
  }
}
