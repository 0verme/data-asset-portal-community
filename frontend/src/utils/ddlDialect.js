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

import { DEFAULT_DATA_TYPE, normalizeDataType } from "../constants/dataTypes.js";

const POSTGRESQL_DIALECT = "postgresql";
const DWS_DIALECT = "dws";

export function getDDLDialectLabel(dialect, options = {}) {
  const normalized = String(dialect || POSTGRESQL_DIALECT).trim().toLowerCase();
  const isMock = Boolean(options.mock);
  if (normalized === DWS_DIALECT) {
    return "Huawei DWS SQL";
  }
  return isMock ? "Mock PostgreSQL SQL" : "PostgreSQL SQL";
}

function mapFieldType(field) {
  return normalizeDataType(field?.type || DEFAULT_DATA_TYPE);
}

function pickDistributionKey(fields) {
  const pkField = fields.find((field) => field.pk);
  if (pkField?.name) return pkField.name;

  const idField = fields.find((field) => String(field.name || "").toLowerCase().endsWith("_id"));
  return idField?.name || null;
}

function escapeComment(value) {
  return String(value || "").replaceAll("'", "''");
}

export function generateDDLByDialect(table, dialect) {
  const normalizedDialect = String(dialect || POSTGRESQL_DIALECT).trim().toLowerCase();
  const fields = Array.isArray(table?.fields) ? table.fields : [];
  const schemaName = String(table?.schema || `dws_${table?.layer || "dwm"}`).toLowerCase();
  const qualifiedName = `${schemaName}.${table.name}`;
  const pad = Math.max(...fields.map((field) => String(field.name || "").length), 0) + 2;

  const ddlLines = [
    `CREATE TABLE IF NOT EXISTS ${qualifiedName} (`,
    fields.map((field) => {
      const notNull = field.nullable ? "" : " NOT NULL";
      return `    ${field.name.padEnd(pad)} ${mapFieldType(field)}${notNull}`;
    }).join(",\n"),
    ")",
  ];

  if (normalizedDialect === DWS_DIALECT) {
    const distributionKey = pickDistributionKey(fields);
    if (distributionKey) {
      ddlLines[ddlLines.length - 1] += `\nDISTRIBUTE BY HASH(${distributionKey})`;
    }
  }

  ddlLines[ddlLines.length - 1] += ";";

  const commentLines = [];
  if (table?.cn) {
    commentLines.push(`COMMENT ON TABLE ${qualifiedName} IS '${escapeComment(table.cn)}';`);
  }
  fields.forEach((field) => {
    if (!field?.cn) return;
    commentLines.push(`COMMENT ON COLUMN ${qualifiedName}.${field.name} IS '${escapeComment(field.cn)}';`);
  });

  return [...ddlLines, "", ...commentLines].join("\n").trimEnd();
}

export function normalizeDDLResponse(payload, options = {}) {
  if (typeof payload === "string") {
    return {
      ddl: payload,
      ddlDialect: POSTGRESQL_DIALECT,
      ddlDialectLabel: getDDLDialectLabel(POSTGRESQL_DIALECT, options),
    };
  }

  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (data && typeof data.ddl === "string") {
    const ddlDialect = String(data.ddlDialect || POSTGRESQL_DIALECT).trim().toLowerCase() || POSTGRESQL_DIALECT;
    return {
      ddl: data.ddl,
      ddlDialect,
      ddlDialectLabel: data.ddlDialectLabel || getDDLDialectLabel(ddlDialect, options),
    };
  }

  throw new Error("接口返回的 DDL 格式不正确");
}
