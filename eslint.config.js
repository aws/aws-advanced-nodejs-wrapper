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

import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-plugin-prettier";
import header from "eslint-plugin-header";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default defineConfig([
  globalIgnores(["**/node_modules", "**/gradle", "**/dist", "**/coverage"]),
  {
    extends: compat.extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/eslint-recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:prettier/recommended",
      "prettier"
    ),

    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
      header
    },

    languageOptions: {
      globals: {
        ...globals.browser
      },

      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },

    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",

      "prettier/prettier": [
        "error",
        {
          endOfLine: "auto"
        }
      ],

      "header/header": [
        1,
        "block",
        [
          "",
          "  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.",
          " ",
          '  Licensed under the Apache License, Version 2.0 (the "License").',
          "  You may not use this file except in compliance with the License.",
          "  You may obtain a copy of the License at",
          " ",
          "  http://www.apache.org/licenses/LICENSE-2.0",
          " ",
          "  Unless required by applicable law or agreed to in writing, software",
          '  distributed under the License is distributed on an "AS IS" BASIS,',
          "  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.",
          "  See the License for the specific language governing permissions and",
          "  limitations under the License.",
          ""
        ],
        2
      ]
    }
  }
]);
