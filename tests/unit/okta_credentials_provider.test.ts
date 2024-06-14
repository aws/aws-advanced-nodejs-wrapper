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

import { anything, instance, spy } from "ts-mockito";
import { WrapperProperties } from "aws-wrapper-common-lib/lib/wrapper_property";
import { readFileSync } from "fs";
import { OktaCredentialsProviderFactory } from "aws-wrapper-common-lib/lib/plugins/federated_auth/okta_credentials_provider_factory";
import axios from "axios";

const username = "someFederatedUsername@example.com";
const password = "ec2amazab3cdef";
const endpoint = "example.okta.com";
const applicationId = "example.okta.com";
const props = new Map<string, any>();

const sessionTokenJson = JSON.parse(readFileSync("tests/unit/resources/okta/session-token.json", "utf8"));
const samlAssertionHtml = readFileSync("tests/unit/resources/okta/saml-assertion.html", "utf8");
const expectedSamlAssertion = readFileSync("tests/unit/resources/okta/assertion.txt", "utf8");

jest.mock("axios");

describe("oktaCredentialsProviderTest", () => {
  it("testGetSamlAssertion", async () => {
    WrapperProperties.IDP_ENDPOINT.set(props, endpoint);
    WrapperProperties.APP_ID.set(props, applicationId);
    WrapperProperties.IDP_USERNAME.set(props, username);
    WrapperProperties.IDP_PASSWORD.set(props, password);

    const postResponse = { data: sessionTokenJson };
    const getResponse = { data: samlAssertionHtml };

    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.request.mockResolvedValueOnce(postResponse).mockResolvedValueOnce(getResponse);

    const spyCredentialsFactory = spy(new OktaCredentialsProviderFactory());

    const samlAssertion = await instance(spyCredentialsFactory).getSamlAssertion(props);

    expect(samlAssertion).toBe(expectedSamlAssertion);
  });
});