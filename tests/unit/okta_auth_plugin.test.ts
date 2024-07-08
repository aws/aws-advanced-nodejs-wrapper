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

import { anything, instance, mock, spy, verify, when } from "ts-mockito";
import { PluginService } from "../../common/lib/plugin_service";
import { CredentialsProviderFactory } from "../../common/lib/plugins/federated_auth/credentials_provider_factory";
import { IamAuthUtils, TokenInfo } from "../../common/lib/utils/iam_auth_utils";
import { HostInfo } from "../../common/lib/host_info";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { DatabaseDialect } from "../../common/lib/database_dialect/database_dialect";
import { Credentials } from "aws-sdk";
import { OktaAuthPlugin } from "../../common/lib/plugins/federated_auth/okta_auth_plugin";

const defaultPort = 1234;
const hostInfo = new HostInfo("pg.testdb.us-east-2.rds.amazonaws.com", defaultPort);
const dbUser = "iamUser";
const region = "us-east-2";
const testToken = "someTestToken";
const testTokenInfo = new TokenInfo(testToken, Date.now() + 300000);

const mockPluginService = mock(PluginService);
const mockDialect = mock<DatabaseDialect>();
const mockDialectInstance = instance(mockDialect);
const mockCredentials = mock(Credentials);
const spyIamUtils = spy(IamAuthUtils);
const mockCredentialsProviderFactory = mock<CredentialsProviderFactory>();
const mockConnectFunc = jest.fn().mockImplementation(() => {
  return;
});

describe("oktaAuthTest", () => {
  let spyPlugin: OktaAuthPlugin;
  let props: Map<string, any>;

  beforeEach(() => {
    props = new Map<string, any>();
    WrapperProperties.PLUGINS.set(props, "okta");
    WrapperProperties.DB_USER.set(props, dbUser);
    spyPlugin = spy(new OktaAuthPlugin(instance(mockPluginService), instance(mockCredentialsProviderFactory)));
    when(mockPluginService.getDialect()).thenReturn(mockDialectInstance);
    when(mockDialect.getDefaultPort()).thenReturn(defaultPort);
    when(mockCredentialsProviderFactory.getAwsCredentialsProvider(anything(), anything(), anything())).thenResolve(mockCredentials);
  });

  afterEach(() => {
    OktaAuthPlugin.clearCache();
  });

  it("testCachedToken", async () => {
    const spyPluginInstance = instance(spyPlugin);
    const key = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${defaultPort}:iamUser`;

    OktaAuthPlugin["tokenCache"].set(key, testTokenInfo);

    await spyPluginInstance.connect(hostInfo, props, false, mockConnectFunc);

    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testExpiredCachedToken", async () => {
    const spyPluginInstance = instance(spyPlugin);
    const key = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${defaultPort}:iamUser`;

    const someExpiredToken = "someExpiredToken";
    const expiredTokenInfo = new TokenInfo(someExpiredToken, Date.now() - 300000);

    OktaAuthPlugin["tokenCache"].set(key, expiredTokenInfo);

    when(spyIamUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything())).thenResolve(testToken);

    await spyPluginInstance.connect(hostInfo, props, false, mockConnectFunc);

    verify(spyIamUtils.generateAuthenticationToken(hostInfo.host, defaultPort, region, dbUser, mockCredentials)).called();
    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testNoCachedToken", async () => {
    const spyPluginInstance = instance(spyPlugin);
    when(spyIamUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything())).thenResolve(testToken);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);

    verify(spyIamUtils.generateAuthenticationToken(hostInfo.host, defaultPort, region, dbUser, mockCredentials)).called();
    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testSpecifiedIamHostPortRegion", async () => {
    const spyPluginInstance = instance(spyPlugin);
    const expectedHost = "pg.testdb.us-west-2.rds.amazonaws.com";
    const expectedPort = 9876;
    const expectedRegion = "us-west-2";

    WrapperProperties.IAM_HOST.set(props, expectedHost);
    WrapperProperties.IAM_DEFAULT_PORT.set(props, expectedPort);
    WrapperProperties.IAM_REGION.set(props, expectedRegion);

    const key = `us-west-2:pg.testdb.us-west-2.rds.amazonaws.com:${expectedPort}:iamUser`;

    OktaAuthPlugin["tokenCache"].set(key, testTokenInfo);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);

    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
  });

  it("testIdpCredentialsFallback", async () => {
    const spyPluginInstance = instance(spyPlugin);
    const expectedUser = "expectedUser";
    const expectedPassword = "expectedPassword";

    WrapperProperties.USER.set(props, expectedUser);
    WrapperProperties.PASSWORD.set(props, expectedPassword);

    const key = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${defaultPort}:iamUser`;
    OktaAuthPlugin["tokenCache"].set(key, testTokenInfo);

    await spyPluginInstance.connect(hostInfo, props, true, mockConnectFunc);
    expect(dbUser).toBe(WrapperProperties.USER.get(props));
    expect(testToken).toBe(WrapperProperties.PASSWORD.get(props));
    expect(expectedUser).toBe(WrapperProperties.IDP_USERNAME.get(props));
    expect(expectedPassword).toBe(WrapperProperties.IDP_PASSWORD.get(props));
  });
});
