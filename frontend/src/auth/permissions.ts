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
 * Frontend's machine-readable mirror of the backend Permission Contract.
 *
 * Remote permissions from `/auth/me` are authoritative. The built-in maps are
 * used only by the local Mock auth mode, so the demo remains deterministic.
 */
export const PERMISSION_CODES = Object.freeze([
  "asset:read",
  "asset:write",
  "root:read",
  "root:write",
  "indicator:read",
  "indicator:write",
  "report:read",
  "report:write",
  "api_asset:read",
  "api_asset:write",
  "upstream:read",
  "upstream:write",
  "push:read",
  "push:write",
  "code_table:read",
  "code_table:write",
  "field_mapping:read",
  "lineage:read",
  "metadata:read",
  "metadata:write",
  "operation_log:read",
  "system:user:read",
  "system:user:write",
  "system:menu:read",
  "system:menu:write",
  "system:param:read",
  "system:param:write",
  "system:role:read",
  "system:role:write",
] as const);

export type PermissionCode = typeof PERMISSION_CODES[number];

/**
 * Contract mirror used by the mock adapter and legacy client normalization.
 * Remote role candidates are filtered by the backend's assignable-only API.
 */
export const PUBLIC_PERMISSION_CODES = Object.freeze([
  "asset:read",
  "root:read",
  "indicator:read",
  "report:read",
  "api_asset:read",
  "code_table:read",
  "field_mapping:read",
  "lineage:read",
] as const satisfies readonly PermissionCode[]);

const MAINTAINER_PERMISSIONS = Object.freeze([
  "asset:write",
  "root:write",
  "indicator:write",
  "report:write",
  "api_asset:write",
  "upstream:read",
  "upstream:write",
  "push:read",
  "push:write",
  "code_table:write",
  "metadata:read",
  "metadata:write",
  "operation_log:read",
] as const satisfies readonly PermissionCode[]);

export const MOCK_ROLE_PERMISSIONS = Object.freeze({
  admin: PERMISSION_CODES,
  maintainer: MAINTAINER_PERMISSIONS,
});

type PermissionSource = {
  permissions?: readonly string[] | null;
};

const REGISTERED_PERMISSIONS: ReadonlySet<PermissionCode> = new Set(PERMISSION_CODES);
const PUBLIC_PERMISSIONS: ReadonlySet<PermissionCode> = new Set(PUBLIC_PERMISSION_CODES);

function isPermissionCode(permission: string): permission is PermissionCode {
  return REGISTERED_PERMISSIONS.has(permission as PermissionCode);
}

export function normalizePermissions(value: unknown): PermissionCode[] {
  if (!Array.isArray(value)) return [];
  const values: unknown[] = value;
  return [...new Set(
    values
      .map((permission) => String(permission || "").trim().toLowerCase())
      .filter(isPermissionCode),
  )].sort();
}

export function isPublicPermission(permission: unknown): boolean {
  const normalized = String(permission || "").trim().toLowerCase();
  return PUBLIC_PERMISSIONS.has(normalized as PermissionCode);
}

export function getEffectivePermissions(rolePermissions: unknown): PermissionCode[] {
  return normalizePermissions([
    ...PUBLIC_PERMISSION_CODES,
    ...normalizePermissions(rolePermissions),
  ]);
}

export function normalizeRolePermissionCodes(value: unknown): PermissionCode[] {
  return normalizePermissions(value).filter((permission) => !isPublicPermission(permission));
}

export function hasPermission(
  auth: PermissionSource | null | undefined,
  permission: string | null | undefined,
): boolean {
  const normalized = String(permission || "").trim().toLowerCase();
  return Boolean(
    normalized
    && Array.isArray(auth?.permissions)
    && auth.permissions.includes(normalized),
  );
}

export function hasAnyPermission(
  auth: PermissionSource | null | undefined,
  permissions: readonly string[] = [],
): boolean {
  return permissions.some((permission) => hasPermission(auth, permission));
}
