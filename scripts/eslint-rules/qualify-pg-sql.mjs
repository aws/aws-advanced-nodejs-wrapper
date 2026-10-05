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

// Requires every search_path-resolvable element of a PostgreSQL query the driver
// issues internally — function, operator, LIKE and cast — to be schema-qualified.
// Postgres resolves unqualified names through the session search_path, so a
// shadowing object in an earlier schema can hijack the queries behind dialect
// detection, topology discovery and failover.
//
// SQL strings are parsed with the real PostgreSQL grammar, which resolves
// SQL-standard constructs such as COALESCE, EXTRACT, SUBSTRING and POSITION to
// pg_catalog on its own, so those raise no findings. A string is only treated as
// SQL if it parses; statements that interpolate a value which cannot stand in as
// a placeholder (`SET ... TRANSACTION READ ${mode}`) are skipped.

import { loadModule, parseSync } from "libpg-query";

await loadModule();

const SQL_START = /^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|SET|SHOW|CREATE|ALTER|DROP|TRUNCATE|CALL|BEGIN|COMMIT|ROLLBACK)\b/i;

// Stand-ins tried, in order, for an interpolated value. The first that yields a
// parsable statement wins.
const PLACEHOLDERS = ["1", "x", "'x'"];

// Operator expressions that accept an OPERATOR(schema.op) qualifier. IN, BETWEEN
// and IS DISTINCT FROM report a bare operator name that the grammar gives no way
// to qualify.
const QUALIFIABLE_OPERATORS = new Set(["AEXPR_OP", "AEXPR_OP_ANY", "AEXPR_OP_ALL", "AEXPR_LIKE", "AEXPR_ILIKE", "AEXPR_SIMILAR"]);

function nameParts(names) {
  return (names ?? []).map((entry) => entry?.String?.sval).filter((part) => typeof part === "string");
}

// Flattens a string literal, template literal or `+` chain into the pieces that
// make up one SQL string, or returns false if the expression is not purely one.
function collectPieces(node, pieces) {
  switch (node.type) {
    case "Literal":
      if (typeof node.value !== "string") {
        return false;
      }
      // Escapes shift the offsets used to point at a finding, so only an
      // escape-free literal is mapped back to an exact position.
      pieces.push({ node, text: node.value, exact: node.raw.slice(1, -1) === node.value, textStart: node.range[0] + 1 });
      return true;
    case "TemplateLiteral":
      pieces.push({ node, quasis: node.quasis.map((quasi) => quasi.value.cooked ?? ""), exact: false });
      return true;
    case "BinaryExpression":
      return node.operator === "+" && collectPieces(node.left, pieces) && collectPieces(node.right, pieces);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return collectPieces(node.expression, pieces);
    default:
      return false;
  }
}

function assemble(pieces, placeholder) {
  let sql = "";
  const spans = [];
  for (const piece of pieces) {
    const text = piece.quasis ? piece.quasis.join(placeholder) : piece.text;
    spans.push({ piece, start: sql.length, end: sql.length + text.length });
    sql += text;
  }
  return { sql, spans };
}

function parseQuery(pieces) {
  const interpolates = pieces.some((piece) => piece.quasis && piece.quasis.length > 1);
  for (const placeholder of interpolates ? PLACEHOLDERS : PLACEHOLDERS.slice(0, 1)) {
    const assembled = assemble(pieces, placeholder);
    try {
      return { ...assembled, ast: parseSync(assembled.sql) };
    } catch {
      // Not parsable with this stand-in; try the next.
    }
  }
  return null;
}

function findUnqualified(node, findings) {
  if (node === null || typeof node !== "object") {
    return findings;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      findUnqualified(child, findings);
    }
    return findings;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "FuncCall") {
      const parts = nameParts(value.funcname);
      if (parts.length === 1) {
        findings.push({ messageId: "unqualifiedFunction", name: parts[0], location: value.location });
      }
    } else if (key === "A_Expr" && QUALIFIABLE_OPERATORS.has(value.kind ?? "AEXPR_OP")) {
      const parts = nameParts(value.name);
      if (parts.length === 1) {
        findings.push({ messageId: "unqualifiedOperator", name: parts[0], location: value.location });
      }
    } else if (key === "TypeCast") {
      const parts = nameParts(value.typeName?.names);
      if (parts.length === 1) {
        findings.push({ messageId: "unqualifiedType", name: parts[0], location: value.location });
      }
    }
    findUnqualified(value, findings);
  }
  return findings;
}

// Translates an offset into the assembled SQL back to a position in the source.
function sourcePosition(sourceCode, spans, location) {
  if (typeof location !== "number" || location < 0) {
    return null;
  }
  const span = spans.find((candidate) => location >= candidate.start && location < candidate.end);
  if (!span?.piece.exact) {
    return null;
  }
  const index = span.piece.textStart + (location - span.start);
  if (index < span.piece.node.range[0] || index >= span.piece.node.range[1]) {
    return null;
  }
  return sourceCode.getLocFromIndex(index);
}

function isPartOfLargerString(node) {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  return (
    (parent.type === "BinaryExpression" && parent.operator === "+") || parent.type === "TSAsExpression" || parent.type === "TSSatisfiesExpression"
  );
}

function check(context, node) {
  if (isPartOfLargerString(node)) {
    return;
  }
  const pieces = [];
  if (!collectPieces(node, pieces)) {
    return;
  }
  const head = pieces[0].quasis ? pieces[0].quasis[0] : pieces[0].text;
  if (!SQL_START.test(head)) {
    return;
  }
  const parsed = parseQuery(pieces);
  if (!parsed) {
    return;
  }
  const sourceCode = context.sourceCode;
  for (const finding of findUnqualified(parsed.ast, [])) {
    const loc = sourcePosition(sourceCode, parsed.spans, finding.location);
    context.report({
      node,
      ...(loc ? { loc } : {}),
      messageId: finding.messageId,
      data: { name: finding.name }
    });
  }
}

export const qualifyPgSql = {
  meta: {
    type: "problem",
    docs: {
      description: "Require functions, operators and casts in driver-issued PostgreSQL queries to be schema-qualified"
    },
    schema: [],
    messages: {
      unqualifiedFunction: 'Unqualified function "{{name}}" in a PostgreSQL query. Write "pg_catalog.{{name}}" so search_path cannot redirect it.',
      unqualifiedOperator:
        'Unqualified operator "{{name}}" in a PostgreSQL query. Write "OPERATOR(pg_catalog.{{name}})" so search_path cannot redirect it.',
      unqualifiedType: 'Unqualified type "{{name}}" in a cast. Write "::pg_catalog.{{name}}" so search_path cannot redirect it.'
    }
  },
  create(context) {
    return {
      Literal: (node) => check(context, node),
      TemplateLiteral: (node) => check(context, node),
      BinaryExpression: (node) => check(context, node)
    };
  }
};

export default {
  rules: {
    "qualify-pg-sql": qualifyPgSql
  }
};
