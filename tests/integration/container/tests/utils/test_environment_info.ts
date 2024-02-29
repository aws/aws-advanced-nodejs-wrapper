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

import { TestEnvironmentRequest } from "./test_environment_request";
import { TestDatabaseInfo } from "./test_database_info";
import { TestProxyDatabaseInfo } from "./test_proxy_database_info";

export class TestEnvironmentInfo {
  private readonly _request: TestEnvironmentRequest;
  private readonly _awsAccessKeyId: string;
  private readonly _awsSecretAccessKey: string;
  private readonly _awsSessionToken: string;
  private readonly _auroraRegion: string;
  private readonly _auroraClusterName: string;
  private readonly _iamUserName: string;
  private readonly _databaseInfo: TestDatabaseInfo;
  private readonly _proxyDatabaseInfo: TestProxyDatabaseInfo;

  constructor(testInfo: { [s: string]: any }) {
    this._request = new TestEnvironmentRequest(testInfo["request"]);
    this._awsAccessKeyId = String(testInfo["awsAccessKeyId"]);
    this._awsSecretAccessKey = String(testInfo["awsSecretAccessKey"]);
    this._awsSessionToken = String(testInfo["awsSessionToken"]);
    this._auroraRegion = String(testInfo["auroraRegion"]);
    this._auroraClusterName = String(testInfo["auroraClusterName"]);
    this._iamUserName = String(testInfo["iamUsername"]);

    this._databaseInfo = new TestDatabaseInfo(testInfo["databaseInfo"]);
    this._proxyDatabaseInfo = new TestProxyDatabaseInfo(testInfo["proxyDatabaseInfo"]);
  }

  get request(): TestEnvironmentRequest {
    return this._request;
  }

  get awsAccessKeyId(): string {
    return this._awsAccessKeyId;
  }

  get awsSecretAccessKey(): string {
    return this._awsSecretAccessKey;
  }

  get awsSessionToken(): string {
    return this._awsSessionToken;
  }

  get auroraRegion(): string {
    return this._auroraRegion;
  }

  get auroraClusterName(): string {
    return this._auroraClusterName;
  }

  get iamUserName(): string {
    return this._iamUserName;
  }

  get databaseInfo(): TestDatabaseInfo {
    return this._databaseInfo;
  }

  get proxyDatabaseInfo(): TestProxyDatabaseInfo {
    return this._proxyDatabaseInfo;
  }
}
