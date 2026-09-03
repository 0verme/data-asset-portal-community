/// <reference types="vite/client" />
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

import { requestRemote } from './http.ts';
import {
  isPublicPermission,
  MOCK_ROLE_PERMISSIONS,
  normalizeRolePermissionCodes,
  PERMISSION_CODES,
  type PermissionCode,
} from '../auth/permissions.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

const PERMISSION_LABELS: Readonly<Record<PermissionCode, string>> = Object.freeze({
  'asset:read': '数据资产读取',
  'asset:write': '数据资产维护',
  'root:read': '词根读取',
  'root:write': '词根维护',
  'indicator:read': '指标读取',
  'indicator:write': '指标维护',
  'report:read': '报表读取',
  'report:write': '报表维护',
  'api_asset:read': 'API 资产读取',
  'api_asset:write': 'API 资产维护',
  'upstream:read': '上游系统读取',
  'upstream:write': '上游系统维护',
  'push:read': '下游推送读取',
  'push:write': '下游推送维护',
  'code_table:read': '码值表读取',
  'code_table:write': '码值表维护',
  'field_mapping:read': '字段映射读取',
  'lineage:read': '血缘读取',
  'metadata:read': 'Metadata 读取',
  'metadata:write': 'Metadata 写入',
  'operation_log:read': '操作日志读取',
  'system:user:read': '用户管理读取',
  'system:user:write': '用户管理维护',
  'system:menu:read': '菜单管理读取',
  'system:menu:write': '菜单管理维护',
  'system:param:read': '参数管理读取',
  'system:param:write': '参数管理维护',
  'system:role:read': '角色管理读取',
  'system:role:write': '角色管理维护',
});

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error('Unable to clone role payload', { cause: error });
  }
}

function normalizeCollection<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'] as T[];
  return [];
}

function normalizeDetail<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' ? record['data'] : payload) as T;
  }
  throw new Error('Invalid role payload');
}

export interface SystemPermissionItem {
  code: string;
  resource?: string | undefined;
  action?: string | undefined;
  name: string;
  description: string;
}

export interface SystemRoleItem {
  roleCode: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: string;
  permissionCodes: PermissionCode[];
  userCount?: number | undefined;
  [key: string]: unknown;
}

export interface SystemRolePayload {
  roleCode: string;
  name: string;
  description?: string | undefined;
  enabled?: string | undefined;
  permissionCodes?: readonly string[] | undefined;
  [key: string]: unknown;
}

function mockPermissions(): SystemPermissionItem[] {
  return PERMISSION_CODES.map((code) => {
    const parts = code.split(/:(?=[^:]+$)/);
    const resource = parts[0] || '';
    const action = parts[1] || '';
    return {
      code,
      resource,
      action,
      name: PERMISSION_LABELS[code] || code,
      description: PERMISSION_LABELS[code] || code,
    };
  });
}

function mockRoles(): SystemRoleItem[] {
  return [
    {
      roleCode: 'admin',
      name: '系统管理员',
      description: '拥有全部已注册权限。',
      builtin: true,
      enabled: 'enabled',
      permissionCodes: normalizeRolePermissionCodes(MOCK_ROLE_PERMISSIONS.admin),
      userCount: 1,
    },
    {
      roleCode: 'maintainer',
      name: '业务维护员',
      description: '负责业务元数据维护与操作日志读取。',
      builtin: true,
      enabled: 'enabled',
      permissionCodes: normalizeRolePermissionCodes(MOCK_ROLE_PERMISSIONS.maintainer),
      userCount: 7,
    },
  ];
}

let localRoles: SystemRoleItem[] = mockRoles();

export async function getPermissions(): Promise<SystemPermissionItem[]> {
  if (API_MODE === 'remote') return normalizeCollection<SystemPermissionItem>(await requestRemote('/system/permissions'));
  return clone(mockPermissions());
}

export async function getRoleAssignablePermissions(): Promise<SystemPermissionItem[]> {
  if (API_MODE === 'remote') {
    return normalizeCollection<SystemPermissionItem>(
      await requestRemote('/system/permissions', {
        params: { assignableOnly: 'true' },
      }),
    );
  }
  return clone(mockPermissions().filter((permission) => !isPublicPermission(permission.code)));
}

export async function getRoles(): Promise<SystemRoleItem[]> {
  if (API_MODE === 'remote') return normalizeCollection<SystemRoleItem>(await requestRemote('/system/roles'));
  return clone(localRoles);
}

export async function createRole(payload: SystemRolePayload): Promise<SystemRoleItem> {
  if (API_MODE === 'remote') {
    return normalizeDetail<SystemRoleItem>(await requestRemote('/system/roles', { method: 'POST', body: payload }));
  }
  if (localRoles.some((item) => item.roleCode === payload.roleCode)) {
    throw new Error(`Role already exists: ${payload.roleCode}`);
  }
  const role: SystemRoleItem = {
    roleCode: payload.roleCode,
    name: payload.name,
    description: payload.description || '',
    enabled: payload.enabled || 'enabled',
    builtin: false,
    permissionCodes: normalizeRolePermissionCodes(payload.permissionCodes),
    userCount: 0,
  };
  localRoles = [...localRoles, role];
  return clone(role);
}

export async function updateRole(roleCode: string, payload: SystemRolePayload): Promise<SystemRoleItem> {
  if (API_MODE === 'remote') {
    return normalizeDetail<SystemRoleItem>(
      await requestRemote(`/system/roles/${encodeURIComponent(roleCode)}`, { method: 'PUT', body: payload }),
    );
  }
  const current = localRoles.find((item) => item.roleCode === roleCode);
  if (!current) throw new Error(`Role not found: ${roleCode}`);
  if (current.builtin) throw new Error('Built-in role cannot be updated');
  const next: SystemRoleItem = {
    ...current,
    ...clone(payload),
    roleCode,
    name: payload.name ?? current.name,
    description: payload.description ?? current.description,
    enabled: payload.enabled ?? current.enabled,
    permissionCodes: normalizeRolePermissionCodes(payload.permissionCodes),
  };
  localRoles = localRoles.map((item) => (item.roleCode === roleCode ? next : item));
  return clone(next);
}

export async function deleteRole(roleCode: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/system/roles/${encodeURIComponent(roleCode)}`, { method: 'DELETE' });
    return;
  }
  const current = localRoles.find((item) => item.roleCode === roleCode);
  if (!current) throw new Error(`Role not found: ${roleCode}`);
  if (current.builtin) throw new Error('Built-in role cannot be deleted');
  const userCount = Number(current.userCount || 0);
  if (userCount > 0) {
    throw new Error(`Role is assigned to ${userCount} user(s); unassign them before deleting: ${roleCode}`);
  }
  localRoles = localRoles.filter((item) => item.roleCode !== roleCode);
}
