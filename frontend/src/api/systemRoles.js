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

import { requestRemote } from "./http.js";
import {
  isPublicPermission,
  MOCK_ROLE_PERMISSIONS,
  normalizeRolePermissionCodes,
  PERMISSION_CODES,
} from "../auth/permissions.ts";

const API_MODE = (import.meta.env.VITE_API_MODE || "mock").trim().toLowerCase();

const PERMISSION_LABELS = Object.freeze({
  "asset:read": "数据资产读取",
  "asset:write": "数据资产维护",
  "root:read": "词根读取",
  "root:write": "词根维护",
  "indicator:read": "指标读取",
  "indicator:write": "指标维护",
  "report:read": "报表读取",
  "report:write": "报表维护",
  "api_asset:read": "API 资产读取",
  "api_asset:write": "API 资产维护",
  "upstream:read": "上游系统读取",
  "upstream:write": "上游系统维护",
  "push:read": "下游推送读取",
  "push:write": "下游推送维护",
  "code_table:read": "码值表读取",
  "code_table:write": "码值表维护",
  "field_mapping:read": "字段映射读取",
  "lineage:read": "血缘读取",
  "metadata:read": "Metadata 读取",
  "metadata:write": "Metadata 写入",
  "operation_log:read": "操作日志读取",
  "system:user:read": "用户管理读取",
  "system:user:write": "用户管理维护",
  "system:menu:read": "菜单管理读取",
  "system:menu:write": "菜单管理维护",
  "system:param:read": "参数管理读取",
  "system:param:write": "参数管理维护",
  "system:role:read": "角色管理读取",
  "system:role:write": "角色管理维护",
});

function clone(value) {
  // pi-lens-ignore: unchecked-throwing-call-js
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error("Unable to clone role payload", { cause: error });
  }
}

function normalizeCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function normalizeDetail(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.data && typeof payload.data === "object" ? payload.data : payload;
  }
  throw new Error("Invalid role payload");
}

function mockPermissions() {
  return PERMISSION_CODES.map((code) => {
    const [resource, action] = code.split(/:(?=[^:]+$)/);
    return {
      code,
      resource,
      action,
      name: PERMISSION_LABELS[code] || code,
      description: PERMISSION_LABELS[code] || code,
    };
  });
}

function mockRoles() {
  return [
    {
      roleCode: "admin",
      name: "系统管理员",
      description: "拥有全部已注册权限。",
      builtin: true,
      enabled: "enabled",
      permissionCodes: normalizeRolePermissionCodes(MOCK_ROLE_PERMISSIONS.admin),
      userCount: 1,
    },
    {
      roleCode: "maintainer",
      name: "业务维护员",
      description: "负责业务元数据维护与操作日志读取。",
      builtin: true,
      enabled: "enabled",
      permissionCodes: normalizeRolePermissionCodes(MOCK_ROLE_PERMISSIONS.maintainer),
      userCount: 7,
    },
  ];
}

let localRoles = mockRoles();

export async function getPermissions() {
  if (API_MODE === "remote") return normalizeCollection(await requestRemote("/system/permissions"));
  return clone(mockPermissions());
}

export async function getRoleAssignablePermissions() {
  if (API_MODE === "remote") {
    return normalizeCollection(await requestRemote("/system/permissions", {
      params: { assignableOnly: "true" },
    }));
  }
  return clone(mockPermissions().filter((permission) => !isPublicPermission(permission.code)));
}

export async function getRoles() {
  if (API_MODE === "remote") return normalizeCollection(await requestRemote("/system/roles"));
  return clone(localRoles);
}

export async function createRole(payload) {
  if (API_MODE === "remote") {
    return normalizeDetail(await requestRemote("/system/roles", { method: "POST", body: payload }));
  }
  if (localRoles.some((item) => item.roleCode === payload.roleCode)) throw new Error(`Role already exists: ${payload.roleCode}`);
  const role = {
    ...clone(payload),
    builtin: false,
    permissionCodes: normalizeRolePermissionCodes(payload.permissionCodes),
    userCount: 0,
  };
  localRoles = [...localRoles, role];
  return clone(role);
}

export async function updateRole(roleCode, payload) {
  if (API_MODE === "remote") {
    return normalizeDetail(await requestRemote(`/system/roles/${encodeURIComponent(roleCode)}`, { method: "PUT", body: payload }));
  }
  const current = localRoles.find((item) => item.roleCode === roleCode);
  if (!current) throw new Error(`Role not found: ${roleCode}`);
  if (current.builtin) throw new Error("Built-in role cannot be updated");
  const next = {
    ...current,
    ...clone(payload),
    roleCode,
    permissionCodes: normalizeRolePermissionCodes(payload.permissionCodes),
  };
  localRoles = localRoles.map((item) => (item.roleCode === roleCode ? next : item));
  return clone(next);
}

export async function deleteRole(roleCode) {
  if (API_MODE === "remote") {
    await requestRemote(`/system/roles/${encodeURIComponent(roleCode)}`, { method: "DELETE" });
    return;
  }
  const current = localRoles.find((item) => item.roleCode === roleCode);
  if (current?.builtin) throw new Error("Built-in role cannot be deleted");
  localRoles = localRoles.filter((item) => item.roleCode !== roleCode);
}
