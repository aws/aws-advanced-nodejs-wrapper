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

// Appends explicit ".js" (or "/index.js" for directory imports) to relative
// module specifiers in the emitted declaration files, so the published types
// resolve correctly under Node's "node16"/"nodenext" module resolution. The
// sibling ".js" outputs already receive this treatment from the babel step;
// declaration files are not processed by babel, so they are rewritten here
// using the same filesystem-based resolution.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the dist directory relative to this script (scripts/../dist), so the
// step works regardless of the current working directory.
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");

function* declarationFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* declarationFiles(full);
    } else if (entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

// Mirrors babel-plugin-transform-rewrite-imports: relative file -> "<spec>.js",
// relative directory -> "<spec>/index.js". Bare specifiers are left untouched.
function rewriteSpecifier(fileDir, spec) {
  if (/\.(js|json|mjs|cjs)$/.test(spec)) {
    return spec;
  }
  const target = resolve(fileDir, spec);
  if (existsSync(`${target}.d.ts`)) {
    return `${spec.replace(/\/+$/, "")}.js`;
  }
  if (existsSync(join(target, "index.d.ts")) || (existsSync(target) && statSync(target).isDirectory())) {
    return `${spec.replace(/\/+$/, "")}/index.js`;
  }
  return `${spec.replace(/\/+$/, "")}.js`;
}

const SPECIFIER_PATTERNS = [
  /(\bfrom\s*["'])(\.[^"']*)(["'])/g, // import/export ... from "..."
  /(\bimport\(\s*["'])(\.[^"']*)(["'])/g // dynamic import() type references
];

let changedFiles = 0;
let changedSpecifiers = 0;

for (const file of declarationFiles(DIST)) {
  const fileDir = dirname(file);
  const original = readFileSync(file, "utf8");
  let updated = original;
  for (const pattern of SPECIFIER_PATTERNS) {
    updated = updated.replace(pattern, (_match, lead, spec, trail) => {
      const next = rewriteSpecifier(fileDir, spec);
      if (next !== spec) {
        changedSpecifiers++;
      }
      return `${lead}${next}${trail}`;
    });
  }
  if (updated !== original) {
    writeFileSync(file, updated);
    changedFiles++;
  }
}

console.log(`fix-dts-imports: rewrote ${changedSpecifiers} specifier(s) across ${changedFiles} declaration file(s).`);
