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

import { HostInfo, HostRole } from "../../common/lib";
import { FederatedAuthPlugin } from "../../common/lib/plugins/federated_auth/federated_auth_plugin";
import { OktaAuthPlugin } from "../../common/lib/plugins/federated_auth/okta_auth_plugin";
import { BaseSamlAuthPlugin } from "../../common/lib/plugins/federated_auth/saml_auth_plugin";
import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { IamAuthUtils, TokenInfo } from "../../common/lib/utils/iam_auth_utils";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { anything, instance, mock, reset, spy, verify, when } from "ts-mockito";
import { CredentialsProviderFactory } from "../../common/lib/plugins/federated_auth/credentials_provider_factory";
import { DatabaseDialect } from "../../common/lib/database_dialect/database_dialect";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";
import { PgClientWrapper } from "../../common/lib/pg_client_wrapper";

const testToken = "testToken";
const defaultPort = 5432;
const dbUser = "iamUser";
const expirationFiveMinutes = 5 * 60 * 1000;

const host = "pg.testdb.us-east-2.rds.amazonaws.com";
const iamHost = "pg-123.testdb.us-east-2.rds.amazonaws.com";
const testTokenInfo = new TokenInfo(testToken, Date.now() + expirationFiveMinutes);
const hostInfo = new HostInfo(host, defaultPort, HostRole.WRITER);

const mockDialect = mock<DatabaseDialect>();
const mockDialectInstance = instance(mockDialect);
const mockPluginService = mock(PluginServiceImpl);
const mockCredentialsProviderFactory = mock<CredentialsProviderFactory>();
const mockClientWrapper = mock(PgClientWrapper);
const testCredentials = {
  accessKeyId: "foo",
  secretAccessKey: "bar",
  sessionToken: "baz"
};
const mockConnectFunc = () => Promise.resolve(instance(mockClientWrapper));

describe.each([
  { pluginName: "federatedAuth", PluginClass: FederatedAuthPlugin },
  { pluginName: "okta", PluginClass: OktaAuthPlugin }
])("$pluginName plugin tests", ({ pluginName, PluginClass }) => {
  let plugin: FederatedAuthPlugin | OktaAuthPlugin;
  let spyIamAuthUtils: IamAuthUtils;
  let props: Map<string, any>;

  beforeEach(() => {
    spyIamAuthUtils = spy(new IamAuthUtils());

    when(mockPluginService.getDialect()).thenReturn(mockDialectInstance);
    when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());
    when(mockDialect.getDefaultPort()).thenReturn(defaultPort);
    when(mockCredentialsProviderFactory.getAwsCredentialsProvider(anything(), anything(), anything())).thenResolve(testCredentials);

    props = new Map<string, any>();
    WrapperProperties.PLUGINS.set(props, pluginName);
    WrapperProperties.DB_USER.set(props, dbUser);

    plugin = new PluginClass(instance(mockPluginService), instance(mockCredentialsProviderFactory), instance(spyIamAuthUtils));
  });

  afterEach(() => {
    BaseSamlAuthPlugin.releaseResources();
    reset(spyIamAuthUtils);
  });

  it("testCachedToken", async () => {
    const pgCacheKey = `us-east-2:${host}:${defaultPort}:${dbUser}`;

    BaseSamlAuthPlugin["tokenCache"].set(pgCacheKey, testTokenInfo);

    await plugin.connect(hostInfo, props, true, mockConnectFunc);

    expect(WrapperProperties.USER.get(props)).toBe(dbUser);
    expect(WrapperProperties.PASSWORD.get(props)).toBe(testToken);
  });

  it("testExpiredCachedToken", async () => {
    const key = `us-east-2:${host}:${defaultPort}:${dbUser}`;
    const expiredToken = "expiredToken";
    const expiredTokenInfo = new TokenInfo(expiredToken, Date.now() - 300000);

    BaseSamlAuthPlugin["tokenCache"].set(key, expiredTokenInfo);

    when(spyIamAuthUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything(), anything())).thenResolve(testToken);

    await plugin.connect(hostInfo, props, true, mockConnectFunc);

    expect(WrapperProperties.USER.get(props)).toBe(dbUser);
    expect(WrapperProperties.PASSWORD.get(props)).toBe(testToken);
  });

  it("testNoCachedToken", async () => {
    when(spyIamAuthUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything(), anything())).thenResolve(testToken);

    await plugin.connect(hostInfo, props, true, mockConnectFunc);

    expect(WrapperProperties.USER.get(props)).toBe(dbUser);
    expect(WrapperProperties.PASSWORD.get(props)).toBe(testToken);
  });

  it("testSpecifiedIamHostPortRegion", async () => {
    const expectedHost = "pg.testdb.us-west-2.rds.amazonaws.com";
    const expectedPort = 9876;
    const expectedRegion = "us-west-2";

    WrapperProperties.IAM_HOST.set(props, expectedHost);
    WrapperProperties.IAM_DEFAULT_PORT.set(props, expectedPort);
    WrapperProperties.IAM_REGION.set(props, expectedRegion);

    const key = `${expectedRegion}:${expectedHost}:${expectedPort}:${dbUser}`;
    BaseSamlAuthPlugin["tokenCache"].set(key, testTokenInfo);

    await plugin.connect(hostInfo, props, true, mockConnectFunc);

    expect(WrapperProperties.USER.get(props)).toBe(dbUser);
    expect(WrapperProperties.PASSWORD.get(props)).toBe(testToken);
  });

  it("testIdpCredentialsFallback", async () => {
    const expectedUser = "expectedUser";
    const expectedPassword = "expectedPassword";
    WrapperProperties.USER.set(props, expectedUser);
    WrapperProperties.PASSWORD.set(props, expectedPassword);

    const key = `us-east-2:${host}:${defaultPort}:${dbUser}`;
    BaseSamlAuthPlugin["tokenCache"].set(key, testTokenInfo);

    await plugin.connect(hostInfo, props, true, mockConnectFunc);

    expect(WrapperProperties.USER.get(props)).toBe(dbUser);
    expect(WrapperProperties.PASSWORD.get(props)).toBe(testToken);
    expect(WrapperProperties.IDP_USERNAME.get(props)).toBe(expectedUser);
    expect(WrapperProperties.IDP_PASSWORD.get(props)).toBe(expectedPassword);
  });

  it("testUsingIamHost", async () => {
    WrapperProperties.IAM_HOST.set(props, iamHost);

    when(spyIamAuthUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything(), anything())).thenResolve(testToken);

    await plugin.connect(hostInfo, props, true, mockConnectFunc);

    expect(WrapperProperties.USER.get(props)).toBe(dbUser);
    expect(WrapperProperties.PASSWORD.get(props)).toBe(testToken);
    verify(spyIamAuthUtils.generateAuthenticationToken(iamHost, anything(), anything(), anything(), anything(), anything())).once();
  });
});
