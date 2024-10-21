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

import { PluginService } from "../../common/lib/plugin_service";
import { IamAuthenticationPlugin } from "../../common/lib/authentication/iam_authentication_plugin";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { HostInfo } from "../../common/lib/host_info";
import { AwsClient } from "../../common/lib/aws_client";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import fetch from "node-fetch";
import { anything, instance, mock, spy, when } from "ts-mockito";
import { IamAuthUtils, TokenInfo } from "../../common/lib/utils/iam_auth_utils";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";

const GENERATED_TOKEN: string = "generatedToken";
const TEST_TOKEN: string = "testToken";
const DEFAULT_PG_PORT: number = 5432;
const DEFAULT_MYSQL_PORT: number = 3306;

const PG_CACHE_KEY = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${DEFAULT_PG_PORT}:postgresqlUser`;
const MYSQL_CACHE_KEY = `us-east-2:mysql.testdb.us-east-2.rds.amazonaws.com:${DEFAULT_MYSQL_PORT}:mysqlUser`;

const PG_HOST_INFO: HostInfo = new HostInfoBuilder({
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
  host: "pg.testdb.us-east-2.rds.amazonaws.com"
}).build();

const PG_HOST_INFO_WITH_PORT: HostInfo = new HostInfoBuilder({
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
  host: "pg.testdb.us-east-2.rds.amazonaws.com",
  port: 1234
}).build();

const PG_HOST_INFO_WITH_REGION: HostInfo = new HostInfoBuilder({
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
  host: "pg.testdb.us-west-1.rds.amazonaws.com"
}).build();

const MYSQL_HOST_INFO: HostInfo = new HostInfoBuilder({
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
  host: "mysql.testdb.us-east-2.rds.amazonaws.com"
}).build();

const props = new Map<string, any>();

const mockPluginService: PluginService = mock(PluginService);
const mockClient: AwsClient = mock(AwsClient);
const spyIamAuthUtils = spy(IamAuthUtils);

class IamAuthenticationPluginTestClass extends IamAuthenticationPlugin {
  put(key: string, token: TokenInfo) {
    IamAuthenticationPlugin.tokenCache.set(key, token);
  }

  public async generateAuthenticationToken(
    hostInfo: HostInfo,
    props: Map<string, any>,
    hostname: string,
    port: number,
    region: string
  ): Promise<string> {
    return Promise.resolve(GENERATED_TOKEN);
  }
}

async function testGenerateToken(info: HostInfo, plugin: IamAuthenticationPluginTestClass) {
  await expect(
    plugin.connect(info, props, true, () => {
      return Promise.reject(new AwsWrapperError("TEST ERROR"));
    })
  ).rejects.toThrow(AwsWrapperError);

  expect(WrapperProperties.PASSWORD.get(props)).toEqual(GENERATED_TOKEN);
}

async function testToken(info: HostInfo, plugin: IamAuthenticationPlugin) {
  let calls = 0;

  await expect(
    plugin.connect(info, props, true, () => {
      calls += 1;
      throw new AwsWrapperError("TEST ERROR");
    })
  ).rejects.toThrow(AwsWrapperError);
  expect(calls).toEqual(1);
  expect(WrapperProperties.PASSWORD.get(props)).toEqual(TEST_TOKEN);
}

describe("testIamAuth", () => {
  beforeEach(() => {
    IamAuthenticationPlugin.clearCache();

    props.clear();
    props.set(WrapperProperties.USER.name, "postgresqlUser");
    props.set(WrapperProperties.PASSWORD.name, "postgresqlPassword");
    props.set(WrapperProperties.PLUGINS.name, "iam");

    when(mockPluginService.getCurrentClient()).thenReturn(instance(mockClient));
    when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());
    when(spyIamAuthUtils.generateAuthenticationToken(anything(), anything(), anything(), anything(), anything(), anything())).thenResolve(
      GENERATED_TOKEN
    );
  });

  it("testPostgresConnectValidTokenInCache", async () => {
    when(mockClient.defaultPort).thenReturn(DEFAULT_PG_PORT);

    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));
    plugin.put(PG_CACHE_KEY, new TokenInfo(TEST_TOKEN, Date.now() + 300000));
    await testToken(PG_HOST_INFO, plugin);
  });

  it("testMySqlConnectValidTokenInCache", async () => {
    props.set(WrapperProperties.USER.name, "mysqlUser");
    props.set(WrapperProperties.PASSWORD.name, "mysqlPassword");

    when(mockClient.defaultPort).thenReturn(DEFAULT_MYSQL_PORT);

    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));
    plugin.put(MYSQL_CACHE_KEY, new TokenInfo(TEST_TOKEN, Date.now() + 300000));

    await testToken(MYSQL_HOST_INFO, plugin);
  });

  it("testPostgresConnectWithInvalidPortFallbacksToHostPort", async () => {
    props.set(WrapperProperties.IAM_DEFAULT_PORT.name, 0);

    const cacheKeyWithNewPort: string = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${PG_HOST_INFO_WITH_PORT.port}:postgresqlUser`;
    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));

    plugin.put(cacheKeyWithNewPort, new TokenInfo(TEST_TOKEN, Date.now() + 300000));

    await testToken(PG_HOST_INFO_WITH_PORT, plugin);
  });

  it("testPostgresConnectWithInvalidPortAndNoHostPortFallbacksToHostPort", async () => {
    props.set(WrapperProperties.IAM_DEFAULT_PORT.name, 0);
    when(mockClient.defaultPort).thenReturn(DEFAULT_PG_PORT);

    const cacheKeyWithNewPort: string = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${DEFAULT_PG_PORT}:postgresqlUser`;
    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));

    plugin.put(cacheKeyWithNewPort, new TokenInfo(TEST_TOKEN, Date.now() + 300000));

    await testToken(PG_HOST_INFO, plugin);
  });

  it("testConnectExpiredTokenInCache", async () => {
    when(mockClient.defaultPort).thenReturn(DEFAULT_PG_PORT);
    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));
    plugin.put(PG_CACHE_KEY, new TokenInfo(TEST_TOKEN, Date.now() - 300000));

    await testGenerateToken(PG_HOST_INFO, plugin);
  });

  it("testConnectEmptyCache", async () => {
    when(mockClient.defaultPort).thenReturn(DEFAULT_PG_PORT);
    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));
    await testGenerateToken(PG_HOST_INFO, plugin);
  });

  it("testConnectWithSpecifiedPort", async () => {
    const cacheKeyWithSpecifiedPort: string = "us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:1234:postgresqlUser";
    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));
    plugin.put(cacheKeyWithSpecifiedPort, new TokenInfo(TEST_TOKEN, Date.now() + 300000));

    await testToken(PG_HOST_INFO_WITH_PORT, plugin);
  });

  it("testConnectWithSpecifiedIamDefaultPort", async () => {
    const iamDefaultPort: number = 9999;
    props.set(WrapperProperties.IAM_DEFAULT_PORT.name, iamDefaultPort);

    const cacheKeyWithNewPort: string = `us-east-2:pg.testdb.us-east-2.rds.amazonaws.com:${iamDefaultPort}:postgresqlUser`;
    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));
    plugin.put(cacheKeyWithNewPort, new TokenInfo(TEST_TOKEN, Date.now() + 300000));

    await testToken(PG_HOST_INFO_WITH_PORT, plugin);
  });

  it("testConnectWithSpecifiedRegion", async () => {
    props.set(WrapperProperties.IAM_REGION.name, "us-west-1");
    when(mockClient.defaultPort).thenReturn(DEFAULT_PG_PORT);

    const cacheKeyWithNewRegion: string = `us-west-1:pg.testdb.us-west-1.rds.amazonaws.com:${DEFAULT_PG_PORT}:postgresqlUser`;
    const plugin = new IamAuthenticationPluginTestClass(instance(mockPluginService));
    plugin.put(cacheKeyWithNewRegion, new TokenInfo(TEST_TOKEN, Date.now() + 300000));

    await testToken(PG_HOST_INFO_WITH_REGION, plugin);
  });

  it("testAwsSupportedRegionsUrlExists", async () => {
    const res = await fetch("https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html");
    expect(res.status).toEqual(200);
  });
});
