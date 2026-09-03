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
import { SYSTEM_USERS, type MockSystemUser } from '../data/systemUsers.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

let mockUsers: MockSystemUser[] = clone(SYSTEM_USERS as MockSystemUser[]);

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error('Unable to clone system user payload', { cause: error });
  }
}

function readStore(): MockSystemUser[] {
  return clone(mockUsers);
}

function writeStore(users: MockSystemUser[]): void {
  mockUsers = clone(users);
}

function normalizeCollection<T>(payload: unknown, fallbackKey?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const record = payload as Record<string, unknown> | null | undefined;
  if (record && Array.isArray(record['items'])) return record['items'] as T[];
  if (record && fallbackKey && Array.isArray(record[fallbackKey])) return record[fallbackKey] as T[];
  return [];
}

function normalizeDetail<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return (record['data'] && typeof record['data'] === 'object' ? record['data'] : payload) as T;
  }
  throw new Error('Invalid system user payload');
}

function nowText(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function nextUserId(users: readonly MockSystemUser[]): string {
  const maxId = users.reduce((maxValue, item) => {
    const value = Number(String(item.id || '').replace(/\D/g, '')) || 0;
    return Math.max(maxValue, value);
  }, 0);
  return `USR${String(maxId + 1).padStart(3, '0')}`;
}

export interface SystemUserPayload {
  username: string;
  displayName: string;
  role: string;
  deptName?: string | undefined;
  email?: string | undefined;
  status?: string | undefined;
  remark?: string | undefined;
  id?: string | undefined;
  createdAt?: string | undefined;
  lastLoginAt?: string | undefined;
  [key: string]: unknown;
}

export interface PasswordResetResult {
  username: string;
  resetAt: string;
}

export async function getUsers(): Promise<MockSystemUser[]> {
  if (API_MODE === 'remote') {
    const payload = await requestRemote('/system/users');
    return normalizeCollection<MockSystemUser>(payload, 'items');
  }
  return readStore();
}

export async function createUser(payload: SystemUserPayload): Promise<MockSystemUser> {
  if (API_MODE === 'remote') {
    const response = await requestRemote('/system/users', { method: 'POST', body: payload });
    return normalizeDetail<MockSystemUser>(response);
  }

  const users = readStore();
  if (users.some((item) => item.username === payload.username)) {
    throw new Error(`User already exists: ${payload.username}`);
  }
  const nextUser: MockSystemUser = {
    id: nextUserId(users),
    createdAt: nowText(),
    lastLoginAt: '',
    username: payload.username,
    displayName: payload.displayName,
    role: payload.role,
    deptName: payload.deptName || '未分配',
    email: payload.email || `${payload.username}@demo.invalid`,
    status: payload.status || 'enabled',
    remark: payload.remark || '',
  };
  writeStore([nextUser, ...users]);
  return clone(nextUser);
}

export async function updateUser(username: string, payload: SystemUserPayload): Promise<MockSystemUser> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: payload,
    });
    return normalizeDetail<MockSystemUser>(response);
  }

  const users = readStore();
  const current = users.find((item) => item.username === username);
  if (!current) throw new Error(`User not found: ${username}`);
  if (payload.username !== username && users.some((item) => item.username === payload.username)) {
    throw new Error(`User already exists: ${payload.username}`);
  }
  const nextUser: MockSystemUser = {
    ...current,
    ...clone(payload),
    id: current.id,
    username: payload.username ?? current.username,
    displayName: payload.displayName ?? current.displayName,
    role: payload.role ?? current.role,
    deptName: payload.deptName ?? current.deptName,
    email: payload.email ?? current.email,
    status: payload.status ?? current.status,
    remark: payload.remark ?? current.remark,
    createdAt: current.createdAt,
    lastLoginAt: current.lastLoginAt,
  };
  writeStore(users.map((item) => (item.username === username ? nextUser : item)));
  return clone(nextUser);
}

export async function updateUserStatus(username: string, status: string): Promise<MockSystemUser> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/users/${encodeURIComponent(username)}/status`, {
      method: 'PATCH',
      body: { status },
    });
    return normalizeDetail<MockSystemUser>(response);
  }

  const users = readStore();
  const current = users.find((item) => item.username === username);
  if (!current) throw new Error(`User not found: ${username}`);
  const nextUser: MockSystemUser = { ...current, status };
  writeStore(users.map((item) => (item.username === username ? nextUser : item)));
  return clone(nextUser);
}

export async function resetUserPassword(username: string): Promise<PasswordResetResult> {
  if (API_MODE === 'remote') {
    const response = await requestRemote(`/system/users/${encodeURIComponent(username)}/reset-password`, {
      method: 'POST',
    });
    return normalizeDetail<PasswordResetResult>(response);
  }

  const users = readStore();
  const current = users.find((item) => item.username === username);
  if (!current) throw new Error(`User not found: ${username}`);
  return {
    username,
    resetAt: nowText(),
  };
}

export async function deleteUser(username: string): Promise<void> {
  if (API_MODE === 'remote') {
    await requestRemote(`/system/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    return;
  }
  writeStore(readStore().filter((item) => item.username !== username));
}
