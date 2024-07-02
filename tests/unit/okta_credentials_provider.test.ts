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

import { instance, spy } from "ts-mockito";
import { WrapperProperties } from "../../common/lib/wrapper_property";
import { readFileSync } from "fs";
import { OktaCredentialsProviderFactory } from "../../common/lib/plugins/federated_auth/okta_credentials_provider_factory";
import axios from "axios";

const username = "someFederatedUsername@example.com";
const password = "ec2amazab3cdef";
const endpoint = "example.okta.com";
const applicationId = "example.okta.com";

const sessionTokenJson = JSON.parse(readFileSync("tests/unit/resources/okta/session-token.json", "utf8"));
const samlAssertionHtml = readFileSync("tests/unit/resources/okta/saml-assertion.html", "utf8");
const expectedSamlAssertion = readFileSync("tests/unit/resources/okta/expected-assertion.txt", "utf8");
const expectedSessionToken = readFileSync("tests/unit/resources/okta/expected-session-token.txt", "utf8");

const postResponse = { data: sessionTokenJson };
const getResponse = { data: samlAssertionHtml };

const mockedAxios = axios as jest.Mocked<typeof axios>;
jest.mock("axios");

describe("oktaCredentialsProviderTest", () => {
  let props: Map<string, any>;

  beforeEach(() => {
    props = new Map<string, any>();
    WrapperProperties.IDP_ENDPOINT.set(props, endpoint);
    WrapperProperties.APP_ID.set(props, applicationId);
    WrapperProperties.IDP_USERNAME.set(props, username);
    WrapperProperties.IDP_PASSWORD.set(props, password);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("testGetSessionToken", async () => {
    mockedAxios.request.mockResolvedValueOnce(postResponse);
    const spyCredentialsFactory = spy(new OktaCredentialsProviderFactory());
    const sessionToken = await instance(spyCredentialsFactory).getSessionToken(props);

    expect(sessionToken).toBe(expectedSessionToken);
  });

  it("testGetSamlAssertion", async () => {
    mockedAxios.request.mockResolvedValueOnce(postResponse).mockResolvedValueOnce(getResponse);
    const spyCredentialsFactory = spy(new OktaCredentialsProviderFactory());
    const samlAssertion = await instance(spyCredentialsFactory).getSamlAssertion(props);

    expect(samlAssertion).toBe(expectedSamlAssertion);
  });
});
