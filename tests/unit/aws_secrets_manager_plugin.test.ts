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

import { SecretsManagerClient, SecretsManagerServiceException } from "@aws-sdk/client-secrets-manager";
import {
  AwsSecretsManagerPlugin,
  Secret,
  SecretCacheKey
} from "../../common/lib/authentication/aws_secrets_manager_plugin";
import { AwsClient } from "../../common/lib/aws_client";
import { SimpleHostAvailabilityStrategy } from "../../common/lib/host_availability/simple_host_availability_strategy";
import { HostInfo } from "../../common/lib/host_info";
import { HostInfoBuilder } from "../../common/lib/host_info_builder";
import { PluginService } from "../../common/lib/plugin_service";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { Messages } from "../../common/lib/utils/messages";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { anything, instance, mock, reset, verify, when } from "ts-mockito";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";

const secretsManagerClientException: SecretsManagerServiceException = new SecretsManagerServiceException({
  message: "message",
  name: "name",
  $fault: "server",
  $metadata: {}
});

const TEST_PROPS = new Map();
const TEST_SECRET_ID = "testSecret";
const TEST_SECRET_REGION = "us-east-2";
const TEST_USERNAME = "myUsername";
const TEST_PASSWORD = "myPassword";
const TEST_HOST = "host";
const TEST_ARN_1 = "arn:aws:secretsmanager:us-east-2:123456789012:secret:foo";
const TEST_ARN_2 = "arn:aws:secretsmanager:us-west-1:123456789012:secret:boo";
const TEST_ARN_3 = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!cluster-bar-foo";
const TEST_HOSTINFO: HostInfo = new HostInfoBuilder({
  hostAvailabilityStrategy: new SimpleHostAvailabilityStrategy(),
  host: TEST_HOST
}).build();
const TEST_SECRET = new Secret(TEST_USERNAME, TEST_PASSWORD);
const TEST_SECRET_CACHE_KEY = new SecretCacheKey(TEST_SECRET_ID, TEST_SECRET_REGION);

const VALID_SECRET_RESPONSE = {
  SecretString: '{"username": "' + TEST_USERNAME + '", "password": "' + TEST_PASSWORD + '"}',
  $metadata: {}
};

const mockPluginService: PluginService = mock(PluginService);
const mockClient: AwsClient = mock(AwsClient);
const mockSecretsManagerClient: SecretsManagerClient = mock(SecretsManagerClient);
const MYSQL_AUTH_ERROR = new Error("Access denied for user ''@'' (using password: NO)");
const PG_AUTH_ERROR = new Error('password authentication failed for user ""');

let plugin: AwsSecretsManagerPlugin;

let connectCounter = 0;
function mockConnectFunction(): Promise<any> {
  return Promise.resolve();
}

function mockConnectFunctionThrowsUnhandledError(): Promise<any> {
  throw new Error("test");
}

describe("testSecretsManager", () => {
  beforeEach(() => {
    connectCounter = 0;
    TEST_PROPS.set(WrapperProperties.SECRET_ID.name, TEST_SECRET_ID);
    TEST_PROPS.set(WrapperProperties.SECRET_REGION.name, TEST_SECRET_REGION);
    const mockClientInstance = instance(mockClient);
    when(mockPluginService.getCurrentClient()).thenReturn(mockClientInstance);
    when(mockPluginService.getTelemetryFactory()).thenReturn(new NullTelemetryFactory());
    const mockPluginServiceInstance = instance(mockPluginService);
    plugin = new AwsSecretsManagerPlugin(mockPluginServiceInstance, TEST_PROPS);
  });

  afterEach(() => {
    TEST_PROPS.clear();
    reset(mockSecretsManagerClient);
    AwsSecretsManagerPlugin.secretsCache.clear();
  });

  // The plugin will successfully open a connection with a cached secret.
  it("connect with cached secrets", async () => {
    // Add initial cached secret to be used for a connection.
    AwsSecretsManagerPlugin.secretsCache.set(JSON.stringify(TEST_SECRET_CACHE_KEY), TEST_SECRET);

    await plugin.connect(TEST_HOSTINFO, TEST_PROPS, true, mockConnectFunction);

    expect(AwsSecretsManagerPlugin.secretsCache.size).toBe(1);
    verify(mockSecretsManagerClient.send(anything())).never();
    expect(TEST_PROPS.get(WrapperProperties.USER.name)).toBe(TEST_USERNAME);
    expect(TEST_PROPS.get(WrapperProperties.PASSWORD.name)).toBe(TEST_PASSWORD);
  });

  // The plugin will attempt to open a connection with an empty secret cache. The plugin will fetch the
  // secret from the AWS Secrets Manager.
  it("connect with new secrets", async () => {
    when(mockSecretsManagerClient.send(anything())).thenResolve(VALID_SECRET_RESPONSE);
    plugin.secretsManagerClient = instance(mockSecretsManagerClient);

    await plugin.connect(TEST_HOSTINFO, TEST_PROPS, true, mockConnectFunction);

    expect(AwsSecretsManagerPlugin.secretsCache.size).toBe(1);
    verify(mockSecretsManagerClient.send(anything())).once();
    expect(TEST_PROPS.get(WrapperProperties.USER.name)).toBe(TEST_USERNAME);
    expect(TEST_PROPS.get(WrapperProperties.PASSWORD.name)).toBe(TEST_PASSWORD);
  });

  it("missing required parameters", () => {
    expect(async () => {
      await new AwsSecretsManagerPlugin(mockPluginService, new Map()).connect(TEST_HOSTINFO, TEST_PROPS, true, mockConnectFunction);
    }).rejects.toStrictEqual(new AwsWrapperError(Messages.get("AwsSecretsManagerConnectionPlugin.missingRequiredConfigParameter", "secretId")));
  });

  // The plugin will attempt to open a connection with a cached secret, but it will fail with a unhandled error.
  // In this case, the plugin will rethrow the error back to the user.
  it("failed initial connection with unhandled error", async () => {
    // Add initial cached secret to be used for a connection.
    AwsSecretsManagerPlugin.secretsCache.set(JSON.stringify(TEST_SECRET_CACHE_KEY), TEST_SECRET);

    await expect(async () => {
      await plugin.connect(TEST_HOSTINFO, TEST_PROPS, true, mockConnectFunctionThrowsUnhandledError);
    }).rejects.toStrictEqual(new Error("test"));

    expect(AwsSecretsManagerPlugin.secretsCache.size).toBe(1);
    verify(mockSecretsManagerClient.send(anything())).never();
    expect(TEST_PROPS.get(WrapperProperties.USER.name)).toBe(TEST_USERNAME);
    expect(TEST_PROPS.get(WrapperProperties.PASSWORD.name)).toBe(TEST_PASSWORD);
  });

  // The plugin will attempt to open a connection with a cached secret, but it will fail due to authorization errors.
  // In this case, the plugin will fetch the secret and will retry the connection.
  it.each([MYSQL_AUTH_ERROR, PG_AUTH_ERROR])("connect with new secret after trying with cached secrets", async (error) => {
    // Add initial cached secret to be used for a connection.
    AwsSecretsManagerPlugin.secretsCache.set(JSON.stringify(TEST_SECRET_CACHE_KEY), new Secret("", ""));
    when(mockSecretsManagerClient.send(anything())).thenResolve(VALID_SECRET_RESPONSE);
    plugin.secretsManagerClient = instance(mockSecretsManagerClient);

    let connectCounter = 0;
    function testConnectFunction(): Promise<any> {
      if (connectCounter === 0) {
        connectCounter++;
        throw error;
      }
      connectCounter++;
      return Promise.resolve();
    }

    // Fail the initial connection attempt with cached secret.
    // Second attempt should be successful.
    await plugin.connect(TEST_HOSTINFO, TEST_PROPS, true, testConnectFunction);
    expect(AwsSecretsManagerPlugin.secretsCache.size).toBe(1);
    verify(mockSecretsManagerClient.send(anything())).once();
    expect(TEST_PROPS.get(WrapperProperties.USER.name)).toBe(TEST_USERNAME);
    expect(TEST_PROPS.get(WrapperProperties.PASSWORD.name)).toBe(TEST_PASSWORD);
  });

  // The plugin will attempt to open a connection after fetching a secret, but it will fail because an error was
  // thrown by the AWS Secrets Manager.
  it("failed to get secrets", async () => {
    when(mockSecretsManagerClient.send(anything())).thenThrow(secretsManagerClientException);
    plugin.secretsManagerClient = instance(mockSecretsManagerClient);

    await expect(async () => {
      await plugin.connect(TEST_HOSTINFO, TEST_PROPS, true, mockConnectFunction);
    }).rejects.toThrow(new AwsWrapperError(Messages.get("AwsSecretsManagerConnectionPlugin.failedToFetchDbCredentials")));

    expect(AwsSecretsManagerPlugin.secretsCache.size).toBe(0);
    verify(mockSecretsManagerClient.send(anything())).once();
  });

  it.each([
    [TEST_ARN_1, "us-east-2"],
    [TEST_ARN_2, "us-west-1"],
    [TEST_ARN_3, "us-east-2"]
  ])("connect using arn", async (arn, expectedRegionParsedFromARN) => {
    const props = new Map();
    WrapperProperties.SECRET_ID.set(props, arn);
    const testPlugin = new AwsSecretsManagerPlugin(instance(mockPluginService), props);
    const secretKey = testPlugin.secretKey;
    expect(secretKey.region).toBe(expectedRegionParsedFromARN);
  });

  it.each([
    [TEST_ARN_1, "us-east-2"],
    [TEST_ARN_2, "us-west-1"],
    [TEST_ARN_3, "us-east-2"]
  ])("connect using region and arn", async (arn, regionFromArn) => {
    const expectedRegion = "us-iso-east-1";
    const props = new Map();
    WrapperProperties.SECRET_ID.set(props, arn);
    WrapperProperties.SECRET_REGION.set(props, expectedRegion);
    const testPlugin = new AwsSecretsManagerPlugin(instance(mockPluginService), props);
    const secretKey = testPlugin.secretKey;
    // The region specified in `secretsManagerRegion` should override the region parsed from ARN.
    expect(secretKey.region).not.toBe(regionFromArn);
    expect(secretKey.region).toBe(expectedRegion);
  });
});
