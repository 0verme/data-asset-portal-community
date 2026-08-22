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
]);

const MAINTAINER_PERMISSIONS = Object.freeze([
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
]);

export const MOCK_ROLE_PERMISSIONS = Object.freeze({
  admin: PERMISSION_CODES,
  maintainer: MAINTAINER_PERMISSIONS,
});

const REGISTERED_PERMISSIONS = new Set(PERMISSION_CODES);

export function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((permission) => String(permission || "").trim().toLowerCase())
    .filter((permission) => REGISTERED_PERMISSIONS.has(permission)))]
    .sort();
}

export function hasPermission(auth, permission) {
  const normalized = String(permission || "").trim().toLowerCase();
  return Boolean(
    normalized
    && Array.isArray(auth?.permissions)
    && auth.permissions.includes(normalized),
  );
}

export function hasAnyPermission(auth, permissions) {
  return (permissions || []).some((permission) => hasPermission(auth, permission));
}
