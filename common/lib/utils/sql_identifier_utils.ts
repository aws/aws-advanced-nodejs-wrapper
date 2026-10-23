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

// Neither engine accepts a placeholder for the schema in `SET search_path` or the
// database in `USE`, so the driver quotes those identifiers instead.

export class SqlIdentifierUtils {
  static quote(identifier: string, delimiter: string): string {
    if (SqlIdentifierUtils.isQuoted(identifier, delimiter)) {
      return identifier;
    }
    return delimiter + identifier.replaceAll(delimiter, delimiter + delimiter) + delimiter;
  }

  // An already-quoted identifier passes through, so replaying a captured
  // `SET search_path TO "schema"` does not quote it twice.
  private static isQuoted(identifier: string, delimiter: string): boolean {
    if (identifier.length < 2 || !identifier.startsWith(delimiter) || !identifier.endsWith(delimiter)) {
      return false;
    }

    // Quoting is well formed only when every inner delimiter is doubled.
    const interior = identifier.slice(1, -1);
    let index = 0;
    while (index < interior.length) {
      if (interior[index] !== delimiter) {
        index += 1;
      } else if (interior[index + 1] === delimiter) {
        index += 2;
      } else {
        return false;
      }
    }
    return true;
  }
}
