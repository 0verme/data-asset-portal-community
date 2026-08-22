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

import { getCurrentRemoteUser, loginRemote, logoutRemote } from "./api/auth.js";
import {
  hasPermission,
  MOCK_ROLE_PERMISSIONS,
  normalizePermissions,
} from "./auth/permissions.js";

export { hasPermission } from "./auth/permissions.js";

// 认证模式跟随数据模式 VITE_API_MODE：remote → 真实登录(db)，其余 → 演示登录(mock)
export const AUTH_MODE = (import.meta.env.VITE_API_MODE || "mock").trim().toLowerCase() === "remote"
  ? "db"
  : "mock";

const STORAGE_KEY = "dap_auth";

const MOCK_ROLE = (import.meta.env.VITE_MOCK_AUTH_ROLE || "admin").trim().toLowerCase() === "maintainer"
  ? "maintainer"
  : "admin";

const MOCK_USER = (import.meta.env.VITE_MOCK_AUTH_USER || "admin").trim() || "admin";
const MOCK_PASSWORD = import.meta.env.VITE_MOCK_AUTH_PASSWORD || "admin123";
const MOCK_NAME = (import.meta.env.VITE_MOCK_AUTH_NAME || "管理员").trim() || "管理员";

export const GUEST_AUTH = Object.freeze({
  role: "guest",
  user: null,
  name: null,
  permissions: [],
});

function normalizeAuth(auth) {
  if (!auth || typeof auth !== "object") return { ...GUEST_AUTH };
  const role = String(auth.role || "guest").trim().toLowerCase() || "guest";
  const legacyMockPermissions = auth.permissions === undefined
    && AUTH_MODE === "mock"
    ? (MOCK_ROLE_PERMISSIONS[role] || [])
    : auth.permissions;
  return {
    role,
    user: auth.user || null,
    name: auth.name || auth.user || null,
    permissions: normalizePermissions(legacyMockPermissions),
  };
}

function readStoredAuth() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) || window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...GUEST_AUTH };
    return normalizeAuth(JSON.parse(raw));
  } catch {
    return { ...GUEST_AUTH };
  }
}

function persistStoredAuth(auth, remember) {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    const target = remember ? window.localStorage : window.sessionStorage;
    target.setItem(STORAGE_KEY, JSON.stringify(normalizeAuth(auth)));
  } catch {
    // Ignore storage failures and keep the in-memory session only.
  }
}

function clearStoredAuth() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function isDbAuthMode() {
  return AUTH_MODE === "db";
}

export function getAuthModeLabel() {
  return isDbAuthMode() ? "真实登录" : "Mock 登录";
}

export function getMockHint() {
  return `${MOCK_USER} / ${MOCK_PASSWORD}`;
}

export function getInitialAuth() {
  if (isDbAuthMode()) return { ...GUEST_AUTH };
  return readStoredAuth();
}

export async function hydrateAuth() {
  if (isDbAuthMode()) {
    return getCurrentRemoteUser();
  }
  return readStoredAuth();
}

export async function login({ username, password, remember }) {
  if (isDbAuthMode()) {
    return loginRemote({ username, password, remember });
  }

  const normalizedUser = String(username || "").trim();
  if (!normalizedUser) {
    throw new Error("请输入账号");
  }
  if (!password) {
    throw new Error("请输入密码");
  }
  if (normalizedUser !== MOCK_USER || password !== MOCK_PASSWORD) {
    throw new Error("账号或密码不正确，请重试");
  }

  const auth = {
    role: MOCK_ROLE,
    user: MOCK_USER,
    name: MOCK_NAME,
    permissions: MOCK_ROLE_PERMISSIONS[MOCK_ROLE] || [],
  };
  persistStoredAuth(auth, remember);
  return auth;
}

export async function logout() {
  if (isDbAuthMode()) {
    await logoutRemote();
    return;
  }
  clearStoredAuth();
}

export function clearAuthStorage() {
  clearStoredAuth();
}
