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

import path from "path";
import { I18n } from "i18n";
import { fileURLToPath } from "url";
import fs from "fs";

const getModuleDir = () => {
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }
  return path.dirname(fileURLToPath(import.meta.url));
};

const findLocalesDir = (baseDir: string): string => {
  const localesDir = path.join(baseDir, "locales");
  if (fs.existsSync(localesDir)) {
    return localesDir;
  }

  // baseDir wasn't correctly constructed, attempt to resolve path to locales using relative path.
  const pathFromRoot = "../../../common/lib/utils/locales";
  const packageDir = path.resolve(baseDir, pathFromRoot);
  if (fs.existsSync(packageDir)) {
    return packageDir;
  }

  fs.mkdirSync(localesDir, { recursive: true });
  return localesDir;
};

export class Messages {
  static __dirname = getModuleDir();
  private static _i18n: I18n | null = null;

  static get i18n(): I18n {
    if (!Messages._i18n) {
      const localesDir = findLocalesDir(Messages.__dirname);
      Messages._i18n = new I18n({
        locales: ["en"],
        directory: localesDir
      });
    }
    return Messages._i18n;
  }

  static get(key: string, ...val: string[]) {
    return Messages.i18n.__(key, ...val);
  }
}
