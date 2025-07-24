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

import { WrapperProperties } from "../../common/lib/wrapper_property";
import { readFileSync } from "fs";
import { anything, instance, mock, spy, when } from "ts-mockito";
import { AdfsCredentialsProviderFactory } from "../../common/lib/plugins/federated_auth/adfs_credentials_provider_factory";
import { PluginServiceImpl } from "../../common/lib/plugin_service";
import { NullTelemetryFactory } from "../../common/lib/utils/telemetry/null_telemetry_factory";

const props = new Map<string, any>();
const mockPluginService = mock(PluginServiceImpl);
const telemetryFactory = new NullTelemetryFactory();

const signInPageHtml = "tests/unit/resources/federated_auth/adfs-sign-in-page.html";
const adfsSamlHtml = "tests/unit/resources/federated_auth/adfs-saml.html";
const samlAssertionTxt = "tests/unit/resources/federated_auth/saml-assertion.txt";

const signInPage = readFileSync(signInPageHtml, "utf8");
const adfsSaml = readFileSync(adfsSamlHtml, "utf8");
const expectedSamlAssertion = readFileSync(samlAssertionTxt, "utf8").trimEnd();

describe("adfsTest", () => {
  beforeEach(() => {
    WrapperProperties.IDP_USERNAME.set(props, "someFederatedUsername@example.com");
    WrapperProperties.IDP_PASSWORD.set(props, "somePassword");
    when(mockPluginService.getTelemetryFactory()).thenReturn(telemetryFactory);
  });

  it("testGetSamlAssertion", async () => {
    WrapperProperties.IDP_ENDPOINT.set(props, "ec2amaz-ab3cdef.example.com");

    const spyCredentialsFactory = spy(new AdfsCredentialsProviderFactory(instance(mockPluginService)));
    const spyCredentialsFactoryInstance = instance(spyCredentialsFactory);
    when(spyCredentialsFactory.getSignInPageBody(anything(), anything())).thenResolve(signInPage);
    when(spyCredentialsFactory.getFormActionBody(anything(), anything(), anything())).thenResolve(adfsSaml);

    const samlAssertion = await spyCredentialsFactoryInstance.getSamlAssertion(props);
    expect(samlAssertion).toBe(expectedSamlAssertion);

    const params = spyCredentialsFactoryInstance["getParametersFromHtmlBody"](signInPage, props);
    expect(params["UserName"]).toBe("someFederatedUsername@example.com");
    expect(params["Password"]).toBe("somePassword");
    expect(params["Kmsi"]).toBe("true");
    expect(params["AuthMethod"]).toBe("FormsAuthentication");
  });

  it("testGetSamlAssertionUrlScheme", async () => {
    WrapperProperties.IDP_ENDPOINT.set(props, "https://ec2amaz-ab3cdef.example.com");

    const spyCredentialsFactory = spy(new AdfsCredentialsProviderFactory(instance(mockPluginService)));
    const spyCredentialsFactoryInstance = instance(spyCredentialsFactory);
    when(spyCredentialsFactory.getSignInPageBody(anything(), anything())).thenResolve(signInPage);
    when(spyCredentialsFactory.getFormActionBody(anything(), anything(), anything())).thenResolve(adfsSaml);

    const samlAssertion = await spyCredentialsFactoryInstance.getSamlAssertion(props);
    expect(samlAssertion).toBe(expectedSamlAssertion);

    const params = spyCredentialsFactoryInstance["getParametersFromHtmlBody"](signInPage, props);
    expect(params["UserName"]).toBe("someFederatedUsername@example.com");
    expect(params["Password"]).toBe("somePassword");
    expect(params["Kmsi"]).toBe("true");
    expect(params["AuthMethod"]).toBe("FormsAuthentication");
  });
});
