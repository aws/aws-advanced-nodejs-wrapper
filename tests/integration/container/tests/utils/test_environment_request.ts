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

import { DatabaseInstances } from "./database_instances";
import { DatabaseEngineDeployment } from "./database_engine_deployment";
import { TestEnvironmentFeatures } from "./test_environment_features";
import { DatabaseEngine } from "./database_engine";

export class TestEnvironmentRequest {
  private readonly _instances: DatabaseInstances;
  private readonly _deployment: DatabaseEngineDeployment;
  private readonly _features: TestEnvironmentFeatures[];
  private readonly _instanceCount: number = 1;
  private readonly _engine: DatabaseEngine;

  constructor(request: { [s: string]: any }) {
    this._instances = request["instances"];
    this._deployment = request["deployment"];
    this._instanceCount = Number(request["numOfInstances"]);
    this._features = request["features"];
    this._engine = request["engine"] as DatabaseEngine;
  }

  get engine(): DatabaseEngine {
    return this._engine;
  }

  get instances(): DatabaseInstances {
    return this._instances;
  }

  get deployment(): DatabaseEngineDeployment {
    return this._deployment;
  }

  get features(): TestEnvironmentFeatures[] {
    return this._features;
  }

  get instanceCount(): number {
    return this._instanceCount;
  }
}
