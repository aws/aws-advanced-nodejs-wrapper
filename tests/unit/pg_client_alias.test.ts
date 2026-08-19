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

import { AwsPgClient, AwsPGClient } from "../../pg";

// Guards the backwards-compatible deprecated alias. `AwsPGClient` was renamed to
// `AwsPgClient`; the old name must keep resolving to the exact same class so existing
// customer code continues to work until the alias is removed in the next major release.
describe("pg client deprecated alias", () => {
  it("AwsPGClient is the same class as AwsPgClient", () => {
    expect(AwsPGClient).toBe(AwsPgClient);
  });

  it("an instance created via the deprecated alias is an AwsPgClient", () => {
    const client = new AwsPGClient({});
    expect(client).toBeInstanceOf(AwsPgClient);
  });

  it("the deprecated alias is usable in type position", () => {
    // Compile-time guard: `AwsPGClient` must remain valid as a type annotation, not only
    // as a value, so customer code such as `let c: AwsPGClient` keeps compiling.
    const client: AwsPGClient = new AwsPgClient({});
    expect(client).toBeInstanceOf(AwsPGClient);
  });
});
