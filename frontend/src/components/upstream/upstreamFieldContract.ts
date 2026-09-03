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

/**
 * The upstream system field contract is the shared vocabulary for the edit
 * surface and the detail surface. Connection metadata remains admin-only;
 * ordinary business metadata must have a readable detail location.
 */
type DetailLocation = "metadata" | "hero" | "schedule";
type UpstreamFieldKey =
 | "id"
 | "abbr"
 | "name"
 | "dbType"
 | "owner"
 | "dept"
 | "status"
 | "desc"
 | "host"
 | "db"
 | "schema"
 | "unloadTimes";

export interface UpstreamFieldDefinition {
 key: UpstreamFieldKey;
 label: string;
 editable: boolean;
 detailLocations: readonly DetailLocation[];
 mono?: boolean | undefined;
 sensitive?: boolean | undefined;
}

const fieldDefinitions = [
 {
  key: "id",
  label: "系统标识",
  editable: true,
  detailLocations: ["metadata"],
  mono: true,
 },
 {
  key: "abbr",
  label: "系统简称",
  editable: true,
  detailLocations: ["hero", "metadata"],
  mono: true,
 },
 { key: "name", label: "系统名称", editable: true, detailLocations: ["hero"] },
 {
  key: "dbType",
  label: "数据库类型",
  editable: true,
  detailLocations: ["metadata"],
 },
 {
  key: "owner",
  label: "负责人",
  editable: true,
  detailLocations: ["metadata"],
 },
 {
  key: "dept",
  label: "业务部门",
  editable: true,
  detailLocations: ["metadata"],
 },
 { key: "status", label: "状态", editable: true, detailLocations: ["hero"] },
 { key: "desc", label: "系统说明", editable: true, detailLocations: ["hero"] },
 {
  key: "host",
  label: "JDBC 地址",
  editable: true,
  detailLocations: [],
  sensitive: true,
  mono: true,
 },
 {
  key: "db",
  label: "数据库",
  editable: false,
  detailLocations: [],
  sensitive: true,
  mono: true,
 },
 {
  key: "schema",
  label: "Schema",
  editable: true,
  detailLocations: [],
  sensitive: true,
  mono: true,
 },
 {
  key: "unloadTimes",
  label: "卸数时间点",
  editable: true,
  detailLocations: ["schedule"],
  mono: true,
 },
] satisfies readonly UpstreamFieldDefinition[];

const fieldContract: readonly UpstreamFieldDefinition[] = fieldDefinitions.map(
 (definition) =>
  Object.freeze({
   ...definition,
   detailLocations: Object.freeze(definition.detailLocations),
  }),
);

export const UPSTREAM_SYSTEM_FIELD_CONTRACT = Object.freeze(fieldContract);

export const UPSTREAM_EDITABLE_BUSINESS_FIELDS = Object.freeze(
 UPSTREAM_SYSTEM_FIELD_CONTRACT.filter(
  ({ editable, sensitive, key }) =>
   editable && !sensitive && key !== "unloadTimes",
 ),
);

export const UPSTREAM_DETAIL_FIELDS = Object.freeze(
 UPSTREAM_SYSTEM_FIELD_CONTRACT.filter(
  ({ detailLocations }) => detailLocations.length > 0,
 ),
);

export const UPSTREAM_DETAIL_METADATA_FIELDS = Object.freeze(
 UPSTREAM_DETAIL_FIELDS.filter(({ detailLocations }) =>
  detailLocations.includes("metadata"),
 ),
);

const fieldByKey = new Map<string, UpstreamFieldDefinition>(
 UPSTREAM_SYSTEM_FIELD_CONTRACT.map((definition) => [
  definition.key,
  definition,
 ]),
);

export const EMPTY_UPSTREAM_VALUE = "—";

export function getUpstreamFieldLabel(key: string): string {
 return fieldByKey.get(key)?.label || String(key || "");
}

export function displayUpstreamValue(value: unknown): string {
 if (value === null || value === undefined) return EMPTY_UPSTREAM_VALUE;
 if (typeof value === "string" && !value.trim()) return EMPTY_UPSTREAM_VALUE;
 return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
 return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getUpstreamDetailMetadata(
 system: unknown,
): Array<UpstreamFieldDefinition & { value: string }> {
 const source = isRecord(system) ? system : {};
 return UPSTREAM_DETAIL_METADATA_FIELDS.map((definition) => ({
  ...definition,
  value: displayUpstreamValue(source[definition.key]),
 }));
}
