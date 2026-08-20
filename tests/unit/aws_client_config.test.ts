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

import * as ts from "typescript";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AwsClientConfig, WrapperProperties, WrapperProperty } from "../../common/lib/wrapper_property";
import { AwsMySQLClientConfig } from "../../mysql/lib/client";
import { AwsPgClientConfig } from "../../pg/lib/client";

// Standard connection properties supplied by the underlying driver config types
// (`ConnectionOptions` for mysql2, `ClientConfig` for pg), which the driver-specific
// configs inherit. They are intentionally NOT re-declared on `AwsClientConfig`.
const DRIVER_PROVIDED = new Set(["host", "user", "password", "port", "database"]);

// Extract the property names declared on a TypeScript interface, by parsing the
// source file's AST. `AwsClientConfig` is a compile-time-only type, so it cannot
// be introspected at runtime — this reads the actual declaration instead.
function interfacePropertyNames(sourceRelativePath: string, interfaceName: string): string[] {
  const source = readFileSync(join(process.cwd(), sourceRelativePath), "utf8");
  const sourceFile = ts.createSourceFile(sourceRelativePath, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          names.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

// The configuration key each WrapperProperty maps to is its `.name` (the first
// constructor argument), enumerated from the static members at runtime.
function wrapperPropertyNames(): string[] {
  return Object.values(WrapperProperties)
    .filter((value): value is WrapperProperty<any> => value instanceof WrapperProperty)
    .map((property) => property.name);
}

describe("AwsClientConfig stays in sync with WrapperProperties", () => {
  const configKeys = new Set(interfacePropertyNames("common/lib/wrapper_property.ts", "AwsClientConfig"));
  const propertyNames = wrapperPropertyNames();

  it("finds interface keys and wrapper properties (sanity check)", () => {
    expect(configKeys.size).toBeGreaterThan(0);
    expect(propertyNames.length).toBeGreaterThan(0);
  });

  it("declares every WrapperProperty on AwsClientConfig (or inherits it from the driver config)", () => {
    // If this fails, add the listed option(s) to the AwsClientConfig interface in
    // common/lib/wrapper_property.ts so TypeScript consumers can set them.
    const missing = propertyNames.filter((name) => !configKeys.has(name) && !DRIVER_PROVIDED.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it("has no AwsClientConfig key without a matching WrapperProperty (no stale/renamed options)", () => {
    // If this fails, an AwsClientConfig key no longer matches a WrapperProperty
    // name — fix the typo or remove the obsolete option.
    const propertyNameSet = new Set(propertyNames);
    const stale = [...configKeys].filter((key) => !propertyNameSet.has(key)).sort();
    expect(stale).toEqual([]);
  });

  it("keeps the driver-specific configs assignable to AwsClientConfig (compile-time)", () => {
    const asBaseConfig = (config: AwsClientConfig): AwsClientConfig => config;
    expect(asBaseConfig({} as AwsMySQLClientConfig)).toBeDefined();
    expect(asBaseConfig({} as AwsPgClientConfig)).toBeDefined();
  });
});
