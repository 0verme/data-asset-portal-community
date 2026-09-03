// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  DEFAULT_DATA_TYPE,
  normalizeDataType,
} from "../constants/dataTypes.ts";

const POSTGRESQL_DIALECT = "postgresql";
const DWS_DIALECT = "dws";

export interface DialectOptions {
  mock?: boolean;
}

export function getDDLDialectLabel(
  dialect?: unknown,
  options: DialectOptions = {},
): string {
  const normalized = String(dialect || POSTGRESQL_DIALECT)
    .trim()
    .toLowerCase();
  const isMock = Boolean(options.mock);
  if (normalized === DWS_DIALECT) {
    return "Huawei DWS SQL";
  }
  return isMock ? "Mock PostgreSQL SQL" : "PostgreSQL SQL";
}

export interface DDLField {
  name: string;
  cn?: string | undefined;
  type?: string | undefined;
  nullable?: boolean | undefined;
  pk?: boolean | undefined;
}

export interface DDLTable {
  name: string;
  cn?: string | undefined;
  schema?: string | undefined;
  layer?: string | undefined;
  fields?: DDLField[] | undefined;
}

function mapFieldType(field?: DDLField): string {
  return normalizeDataType(field?.type || DEFAULT_DATA_TYPE);
}

function pickDistributionKey(fields: readonly DDLField[]): string | null {
  const pkField = fields.find((field) => field.pk);
  if (pkField?.name) return pkField.name;

  const idField = fields.find((field) =>
    String(field.name || "")
      .toLowerCase()
      .endsWith("_id"),
  );
  return idField?.name || null;
}

function escapeComment(value?: unknown): string {
  return String(value || "").replaceAll("'", "''");
}

export function generateDDLByDialect(
  table: DDLTable,
  dialect?: unknown,
): string {
  const normalizedDialect = String(dialect || POSTGRESQL_DIALECT)
    .trim()
    .toLowerCase();
  const fields = Array.isArray(table?.fields) ? table.fields : [];
  const schemaName = String(
    table?.schema || `dws_${table?.layer || "dwm"}`,
  ).toLowerCase();
  const qualifiedName = `${schemaName}.${table.name}`;
  const pad =
    Math.max(...fields.map((field) => String(field.name || "").length), 0) + 2;

  const ddlLines = [
    `CREATE TABLE IF NOT EXISTS ${qualifiedName} (`,
    fields
      .map((field) => {
        const notNull = field.nullable ? "" : " NOT NULL";
        return `    ${field.name.padEnd(pad)} ${mapFieldType(field)}${notNull}`;
      })
      .join(",\n"),
    ")",
  ];

  if (normalizedDialect === DWS_DIALECT) {
    const distributionKey = pickDistributionKey(fields);
    if (distributionKey) {
      const lastIndex = ddlLines.length - 1;
      if (lastIndex >= 0 && ddlLines[lastIndex] !== undefined) {
        ddlLines[lastIndex] += `\nDISTRIBUTE BY HASH(${distributionKey})`;
      }
    }
  }

  const lastLineIdx = ddlLines.length - 1;
  if (lastLineIdx >= 0 && ddlLines[lastLineIdx] !== undefined) {
    ddlLines[lastLineIdx] += ";";
  }

  const commentLines: string[] = [];
  if (table?.cn) {
    commentLines.push(
      `COMMENT ON TABLE ${qualifiedName} IS '${escapeComment(table.cn)}';`,
    );
  }
  for (const field of fields) {
    if (!field?.cn) continue;
    commentLines.push(
      `COMMENT ON COLUMN ${qualifiedName}.${field.name} IS '${escapeComment(field.cn)}';`,
    );
  }

  return [...ddlLines, "", ...commentLines].join("\n").trimEnd();
}

export interface DDLNormalizedResult {
  ddl: string;
  ddlDialect: string;
  ddlDialectLabel: string;
}

export function normalizeDDLResponse(
  payload?: unknown,
  options: DialectOptions = {},
): DDLNormalizedResult {
  if (typeof payload === "string") {
    return {
      ddl: payload,
      ddlDialect: POSTGRESQL_DIALECT,
      ddlDialectLabel: getDDLDialectLabel(POSTGRESQL_DIALECT, options),
    };
  }

  const record = payload as Record<string, unknown> | null | undefined;
  const data =
    record?.["data"] && typeof record["data"] === "object"
      ? (record["data"] as Record<string, unknown>)
      : record;

  if (data && typeof data["ddl"] === "string") {
    const ddlDialect =
      String(data["ddlDialect"] || POSTGRESQL_DIALECT)
        .trim()
        .toLowerCase() || POSTGRESQL_DIALECT;
    return {
      ddl: data["ddl"],
      ddlDialect,
      ddlDialectLabel:
        typeof data["ddlDialectLabel"] === "string"
          ? data["ddlDialectLabel"]
          : getDDLDialectLabel(ddlDialect, options),
    };
  }

  throw new Error("接口返回的 DDL 格式不正确");
}
