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

import { PluginService } from "aws-wrapper-common-lib/lib/plugin_service";
import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";
import { readFileSync } from "fs";
import { anything, instance, mock, spy, when } from "ts-mockito";
import { AdfsCredentialsProviderFactory } from "../../common/lib/plugins/federated_auth/adfs_credentials_provider_factory";

const props = new Map<string, any>();
const pluginService = mock(PluginService);

describe("adfsTest", () => {
  it("testGetSamlAssertion", async () => {
    WrapperProperties.IDP_ENDPOINT.set(props, "ec2amaz-ab3cdef.example.com");
    WrapperProperties.IDP_USERNAME.set(props, "someFederatedUsername@example.com");
    WrapperProperties.IDP_PASSWORD.set(props, "somePassword");

    const signInPageHtml = "tests/integration/host/src/test/resources/federated_auth/adfs-sign-in-page.html";
    const adfsSamlHtml = "tests/integration/host/src/test/resources/federated_auth/adfs-saml.html";
    const samlAssertionTxt = "tests/integration/host/src/test/resources/federated_auth/saml-assertion.txt";

    const signInPage = readFileSync(signInPageHtml, "utf8");
    const adfsSaml = readFileSync(adfsSamlHtml, "utf8");
    const expectedSamlAssertion = readFileSync(samlAssertionTxt, "utf8").trimEnd();

    const plugin = spy(new AdfsCredentialsProviderFactory());
    const pluginInstance = instance(plugin);
    when(plugin.getSignInPageBody(anything(), anything())).thenResolve(signInPage);
    when(plugin.getFormActionBody(anything(), anything(), anything())).thenResolve(adfsSaml);

    const samlAssertion = await pluginInstance.getSamlAssertion(props);
    expect(samlAssertion).toBe(expectedSamlAssertion);

    const params = pluginInstance["getParametersFromHtmlBody"](signInPage, props);
    expect(params["UserName"]).toBe("someFederatedUsername@example.com");
    expect(params["Password"]).toBe("somePassword");
    expect(params["Kmsi"]).toBe("true");
    expect(params["AuthMethod"]).toBe("FormsAuthentication");
  });
});
