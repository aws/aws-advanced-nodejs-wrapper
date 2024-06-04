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

import { HostInfo } from "aws-wrapper-common-lib/lib/host_info";
import { FederatedAuthPlugin } from "aws-wrapper-common-lib/lib/plugins/federated_auth/federated_auth_plugin";
import { PluginService } from "aws-wrapper-common-lib/lib/plugin_service";
import { IamAuthUtils, TokenInfo } from "aws-wrapper-common-lib/lib/utils/iam_auth_utils";
import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";
import { anything, instance, mock, spy, when } from "ts-mockito";
import { CredentialsProviderFactory } from "../../common/lib/plugins/federated_auth/credentials_provider_factory";
import { DatabaseDialect } from "aws-wrapper-common-lib/lib/database_dialect/database_dialect";
import { Credentials } from "aws-sdk";

const testToken = "testToken";
const defaultPort = 5432;
const pgCacheKey = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${defaultPort}:iamUser`;
const dbUser = "iamUser";
const expirationFiveMinutes = 5 * 60 * 1000;
const tokenCache = new Map<string, TokenInfo>();

const hostInfo = new HostInfo("pg.testdb.us-east-2.rds.amazonaws.com", defaultPort);
const testTokenInfo = new TokenInfo(testToken, Date.now() + expirationFiveMinutes);

const mockDialect = mock<DatabaseDialect>();
const mockDialectInstance = instance(mockDialect);
const mockPluginService = mock(PluginService);
const mockCredentialProviderFactory = mock<CredentialsProviderFactory>();
const spyIamUtils = spy(IamAuthUtils);
const mockCredentials = mock(Credentials);
const mockConnectFunc = jest.fn().mockImplementation(() => {
  return;
});

describe("federatedAuthTest", () => {
  let spyPlugin: FederatedAuthPlugin;
  let props: Map<string, any>;

  beforeEach(() => {
    props = new Map<string, any>();
    WrapperProperties.PLUGINS.set(props, "federatedAuth");
    WrapperProperties.DB_USER.set(props, dbUser);
    spyPlugin = spy(new FederatedAuthPlugin(instance(mockPluginService), instance(mockCredentialProviderFactory)));
    when(mockPluginService.getDialect()).thenReturn(mockDialectInstance);
    when(mockDialect.getDefaultPort()).thenReturn(defaultPort);
    when(mockCredentialProviderFactory.getAwsCredentialsProvider(anything(), anything(), anything())).thenResolve(instance(mockCredentials));
  });

  afterEach(() => {
    FederatedAuthPlugin.clearCache();
  });

  it("testCachedToken", async () => {
    const spyPluginInstance = instance(spyPlugin);
    FederatedAuthPlugin["tokenCache"].set(pgCacheKey, testTokenInfo);

    const key = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${defaultPort}:iamUser`;
    tokenCache.set(key, testTokenInfo);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);

    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testExpiredCachedToken", async () => {
    const spyPluginInstance: FederatedAuthPlugin = instance(spyPlugin);

    const key = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${defaultPort}:iamUser`;
    const expiredToken = "expiredToken";
    const expiredTokenInfo = new TokenInfo(expiredToken, Date.now() - 300000);

    FederatedAuthPlugin["tokenCache"].set(expiredToken, expiredTokenInfo);

    when(spyIamUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything())).thenResolve(testToken);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);

    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testNoCachedToken", async () => {
    const spyPluginInstance = instance(spyPlugin);

    when(spyIamUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything())).thenResolve(testToken);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);
    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testSpecifiedIamHostPortRegion", async () => {
    const expectedHost = "pg.testdb.us-west-2.rds.amazonaws.com";
    const expectedPort = 9876;
    const expectedRegion = "us-west-2";

    WrapperProperties.IAM_HOST.set(props, expectedHost);
    WrapperProperties.IAM_DEFAULT_PORT.set(props, expectedPort);
    WrapperProperties.IAM_REGION.set(props, expectedRegion);

    const key = `us-west-2:pg.testdb.us-west-2.rds.amazonaws.com:${expectedPort}:iamUser`;
    FederatedAuthPlugin["tokenCache"].set(key, testTokenInfo);

    const spyPluginInstance = instance(spyPlugin);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);

    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testIdpCredentialsFallback", async () => {
    const expectedUser = "expectedUser";
    const expectedPassword = "expectedPassword";
    WrapperProperties.USER.set(props, expectedUser);
    WrapperProperties.PASSWORD.set(props, expectedPassword);

    const spyPluginInstance = instance(spyPlugin);

    const key = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${defaultPort}:iamUser`;
    FederatedAuthPlugin["tokenCache"].set(key, testTokenInfo);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);

    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
    expect(expectedUser).toBe(WrapperProperties.IDP_USERNAME.get(props));
    expect(expectedPassword).toBe(WrapperProperties.IDP_PASSWORD.get(props));
  });
});
