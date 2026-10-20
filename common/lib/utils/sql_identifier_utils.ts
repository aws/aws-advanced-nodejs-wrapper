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
  // Matches an identifier the server accepts without quotes.
  private static readonly PLAIN_IDENTIFIER: RegExp = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

  // Quotes each element of a comma-separated identifier list only where needed.
  // Plain names stay unquoted so the server still folds their case, and
  // `schema1, schema2` stays a two-element list instead of one quoted name.
  static quoteListIfNeeded(identifiers: string, delimiter: string): string {
    return SqlIdentifierUtils.splitList(identifiers, delimiter)
      .map((identifier) => identifier.trim())
      .map((identifier) => (SqlIdentifierUtils.PLAIN_IDENTIFIER.test(identifier) ? identifier : SqlIdentifierUtils.quote(identifier, delimiter)))
      .join(", ");
  }

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

  // Splits on commas outside quoted identifiers, so `"a,b", c` has two elements.
  private static splitList(identifiers: string, delimiter: string): string[] {
    const elements: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const character of identifiers) {
      if (character === delimiter) {
        inQuotes = !inQuotes;
      } else if (character === "," && !inQuotes) {
        elements.push(current);
        current = "";
        continue;
      }
      current += character;
    }
    elements.push(current);
    return elements;
  }
}
