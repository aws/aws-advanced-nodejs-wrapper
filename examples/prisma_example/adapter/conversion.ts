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

import { type ColumnType, ColumnTypeEnum } from "@prisma/driver-adapter-utils";
export enum TypeId {
  BOOL = 16,
  BYTEA = 17,
  INT8 = 20,
  INT2 = 21,
  INT4 = 23,
  TEXT = 25,
  OID = 26,
  JSON = 114,
  XML = 142,
  CIDR = 650,
  FLOAT4 = 700,
  FLOAT8 = 701,
  MONEY = 790,
  INET = 869,
  BPCHAR = 1042,
  VARCHAR = 1043,
  DATE = 1082,
  TIME = 1083,
  TIMESTAMP = 1114,
  TIMESTAMPTZ = 1184,
  TIMETZ = 1266,
  BIT = 1560,
  VARBIT = 1562,
  NUMERIC = 1700,
  UUID = 2950,
  JSONB = 3802
}

const ArrayColumnType = {
  BYTEA: 1001,
  CHAR: 1002,
  INT8: 1016,
  INT2: 1005,
  INT4: 1007,
  TEXT: 1009,
  OID: 1028,
  JSON: 199,
  FLOAT4: 1021,
  FLOAT8: 1022,
  VARCHAR: 1015,
  JSONB: 3807,
  DATE: 1182,
  TIMESTAMP: 1115,
  TIMESTAMPTZ: 1116
} as const;

export class UnsupportedNativeDataType extends Error {
  static typeNames: { [key: number]: string } = {
    16: "bool",
    17: "bytea",
    18: "char",
    19: "name",
    20: "int8",
    21: "int2",
    22: "int2vector",
    23: "int4",
    24: "regproc",
    25: "text",
    26: "oid",
    27: "tid",
    28: "xid",
    29: "cid",
    30: "oidvector",
    32: "pg_ddl_command",
    71: "pg_type",
    75: "pg_attribute",
    81: "pg_proc",
    83: "pg_class",
    114: "json",
    142: "xml",
    194: "pg_node_tree",
    269: "table_am_handler",
    325: "index_am_handler",
    600: "point",
    601: "lseg",
    602: "path",
    603: "box",
    604: "polygon",
    628: "line",
    650: "cidr",
    700: "float4",
    701: "float8",
    705: "unknown",
    718: "circle",
    774: "macaddr8",
    790: "money",
    829: "macaddr",
    869: "inet",
    1033: "aclitem",
    1042: "bpchar",
    1043: "varchar",
    1082: "date",
    1083: "time",
    1114: "timestamp",
    1184: "timestamptz",
    1186: "interval",
    1266: "timetz",
    1560: "bit",
    1562: "varbit",
    1700: "numeric",
    1790: "refcursor",
    2202: "regprocedure",
    2203: "regoper",
    2204: "regoperator",
    2205: "regclass",
    2206: "regtype",
    2249: "record",
    2275: "cstring",
    2276: "any",
    2277: "anyarray",
    2278: "void",
    2279: "trigger",
    2280: "language_handler",
    2281: "internal",
    2283: "anyelement",
    2287: "_record",
    2776: "anynonarray",
    2950: "uuid",
    2970: "txid_snapshot",
    3115: "fdw_handler",
    3220: "pg_lsn",
    3310: "tsm_handler",
    3361: "pg_ndistinct",
    3402: "pg_dependencies",
    3500: "anyenum",
    3614: "tsvector",
    3615: "tsquery",
    3642: "gtsvector",
    3734: "regconfig",
    3769: "regdictionary",
    3802: "jsonb",
    3831: "anyrange",
    3838: "event_trigger",
    3904: "int4range",
    3906: "numrange",
    3908: "tsrange",
    3910: "tstzrange",
    3912: "daterange",
    3926: "int8range",
    4072: "jsonpath",
    4089: "regnamespace",
    4096: "regrole",
    4191: "regcollation",
    4451: "int4multirange",
    4532: "nummultirange",
    4533: "tsmultirange",
    4534: "tstzmultirange",
    4535: "datemultirange",
    4536: "int8multirange",
    4537: "anymultirange",
    4538: "anycompatiblemultirange",
    4600: "pg_brin_bloom_summary",
    4601: "pg_brin_minmax_multi_summary",
    5017: "pg_mcv_list",
    5038: "pg_snapshot",
    5069: "xid8",
    5077: "anycompatible",
    5078: "anycompatiblearray",
    5079: "anycompatiblenonarray",
    5080: "anycompatiblerange"
  };

  type: string;

  constructor(code: number) {
    super();
    this.type = UnsupportedNativeDataType.typeNames[code] || "Unknown";
    this.message = `Unsupported column type ${this.type}`;
  }
}

export function fieldToColumnType(fieldTypeId: number): ColumnType {
  switch (fieldTypeId) {
    case TypeId.INT2:
    case TypeId.INT4:
      return ColumnTypeEnum.Int32;
    case TypeId.INT8:
      return ColumnTypeEnum.Int64;
    case TypeId.FLOAT4:
      return ColumnTypeEnum.Float;
    case TypeId.FLOAT8:
      return ColumnTypeEnum.Double;
    case TypeId.BOOL:
      return ColumnTypeEnum.Boolean;
    case TypeId.DATE:
      return ColumnTypeEnum.Date;
    case TypeId.TIME:
    case TypeId.TIMETZ:
      return ColumnTypeEnum.Time;
    case TypeId.TIMESTAMP:
    case TypeId.TIMESTAMPTZ:
      return ColumnTypeEnum.DateTime;
    case TypeId.NUMERIC:
    case TypeId.MONEY:
      return ColumnTypeEnum.Numeric;
    case TypeId.JSON:
    case TypeId.JSONB:
      return ColumnTypeEnum.Json;
    case TypeId.UUID:
      return ColumnTypeEnum.Uuid;
    case TypeId.OID:
      return ColumnTypeEnum.Int64;
    case TypeId.BPCHAR:
    case TypeId.TEXT:
    case TypeId.VARCHAR:
    case TypeId.BIT:
    case TypeId.VARBIT:
    case TypeId.INET:
    case TypeId.CIDR:
    case TypeId.XML:
      return ColumnTypeEnum.Text;
    case TypeId.BYTEA:
      return ColumnTypeEnum.Bytes;
    case ArrayColumnType.INT2:
    case ArrayColumnType.INT4:
      return ColumnTypeEnum.Int32Array;
    case ArrayColumnType.FLOAT4:
      return ColumnTypeEnum.FloatArray;
    case ArrayColumnType.FLOAT8:
      return ColumnTypeEnum.DoubleArray;
    case ArrayColumnType.CHAR:
      return ColumnTypeEnum.CharacterArray;
    case ArrayColumnType.TEXT:
    case ArrayColumnType.VARCHAR:
      return ColumnTypeEnum.TextArray;
    case ArrayColumnType.DATE:
      return ColumnTypeEnum.DateArray;
    case ArrayColumnType.TIMESTAMP:
    case ArrayColumnType.TIMESTAMPTZ:
      return ColumnTypeEnum.DateTimeArray;
    case ArrayColumnType.JSON:
    case ArrayColumnType.JSONB:
      return ColumnTypeEnum.JsonArray;
    case ArrayColumnType.BYTEA:
      return ColumnTypeEnum.BytesArray;
    case ArrayColumnType.OID:
    case ArrayColumnType.INT8:
      return ColumnTypeEnum.Int64Array;
    default:
      if (fieldTypeId >= 10_000) {
        return ColumnTypeEnum.Text;
      }
      throw new UnsupportedNativeDataType(fieldTypeId);
  }
}
