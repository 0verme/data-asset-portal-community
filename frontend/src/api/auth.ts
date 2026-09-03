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
import { normalizePermissions, type PermissionCode } from '../auth/permissions.ts';

export interface AuthSession {
  role: string;
  user: string | null;
  name: string | null;
  permissions: readonly PermissionCode[];
}

export interface LoginCredentials {
  username?: string | undefined;
  password?: string | undefined;
  remember?: boolean | undefined;
}

interface RawAuthPayload {
  data?: {
    role?: string | undefined;
    user?: string | null | undefined;
    name?: string | null | undefined;
    permissions?: readonly string[] | null | undefined;
  } | undefined;
  role?: string | undefined;
  user?: string | null | undefined;
  name?: string | null | undefined;
  permissions?: readonly string[] | null | undefined;
}

function normalizeAuth(payload: unknown): AuthSession {
  const record = payload as RawAuthPayload | null | undefined;
  const data = record?.data && typeof record.data === 'object' ? record.data : record;
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid auth payload');
  }
  const role = String(data.role || 'guest').trim().toLowerCase() || 'guest';
  return {
    role,
    user: (typeof data.user === 'string' ? data.user : null) ?? null,
    name: (typeof data.name === 'string' ? data.name : typeof data.user === 'string' ? data.user : null) ?? null,
    permissions: normalizePermissions(data.permissions),
  };
}

export async function loginRemote({ username, password, remember }: LoginCredentials): Promise<AuthSession> {
  const payload = await requestRemote<RawAuthPayload>('/auth/login', {
    method: 'POST',
    body: { username, password, remember },
  });
  return normalizeAuth(payload);
}

export async function getCurrentRemoteUser(): Promise<AuthSession> {
  // 探测当前登录者：游客无会话时返回 401 属正常结果，
  // 不应触发全局 app:unauthorized（否则刷新就弹登录框）。
  const payload = await requestRemote<RawAuthPayload>('/auth/me', { suppressUnauthorizedEvent: true });
  return normalizeAuth(payload);
}

export async function logoutRemote(): Promise<void> {
  await requestRemote<void>('/auth/logout', {
    method: 'POST',
  });
}
