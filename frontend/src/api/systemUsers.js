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
import { SYSTEM_USERS } from "../data/systemUsers.js";

const API_MODE = (import.meta.env.VITE_API_MODE || "mock").trim().toLowerCase();
let mockUsers = clone(SYSTEM_USERS);

function clone(value) {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error("Unable to clone system user payload", { cause: error });
  }
}

function readStore() {
  return clone(mockUsers);
}

function writeStore(users) {
  mockUsers = clone(users);
}

function normalizeCollection(payload, fallbackKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && fallbackKey && Array.isArray(payload[fallbackKey])) return payload[fallbackKey];
  return [];
}

function normalizeDetail(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload.data && typeof payload.data === "object" ? payload.data : payload;
  }
  throw new Error("Invalid system user payload");
}

function nowText() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function nextUserId(users) {
  const maxId = users.reduce((maxValue, item) => {
    const value = Number(String(item.id || "").replace(/\D/g, "")) || 0;
    return Math.max(maxValue, value);
  }, 0);
  return `USR${String(maxId + 1).padStart(3, "0")}`;
}

export async function getUsers() {
  if (API_MODE === "remote") {
    const payload = await requestRemote("/system/users");
    return normalizeCollection(payload, "items");
  }
  return readStore();
}

export async function createUser(payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote("/system/users", { method: "POST", body: payload });
    return normalizeDetail(response);
  }

  const users = readStore();
  if (users.some((item) => item.username === payload.username)) {
    throw new Error(`User already exists: ${payload.username}`);
  }
  const nextUser = {
    id: nextUserId(users),
    createdAt: nowText(),
    lastLoginAt: "",
    ...clone(payload),
  };
  writeStore([nextUser, ...users]);
  return clone(nextUser);
}

export async function updateUser(username, payload) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/users/${encodeURIComponent(username)}`, {
      method: "PUT",
      body: payload,
    });
    return normalizeDetail(response);
  }

  const users = readStore();
  const current = users.find((item) => item.username === username);
  if (!current) throw new Error(`User not found: ${username}`);
  if (payload.username !== username && users.some((item) => item.username === payload.username)) {
    throw new Error(`User already exists: ${payload.username}`);
  }
  const nextUser = {
    ...current,
    ...clone(payload),
  };
  writeStore(users.map((item) => (item.username === username ? nextUser : item)));
  return clone(nextUser);
}

export async function updateUserStatus(username, status) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/users/${encodeURIComponent(username)}/status`, {
      method: "PATCH",
      body: { status },
    });
    return normalizeDetail(response);
  }

  const users = readStore();
  const current = users.find((item) => item.username === username);
  if (!current) throw new Error(`User not found: ${username}`);
  const nextUser = { ...current, status };
  writeStore(users.map((item) => (item.username === username ? nextUser : item)));
  return clone(nextUser);
}

export async function resetUserPassword(username) {
  if (API_MODE === "remote") {
    const response = await requestRemote(`/system/users/${encodeURIComponent(username)}/reset-password`, {
      method: "POST",
    });
    return normalizeDetail(response);
  }

  const users = readStore();
  const current = users.find((item) => item.username === username);
  if (!current) throw new Error(`User not found: ${username}`);
  return {
    username,
    resetAt: nowText(),
  };
}

export async function deleteUser(username) {
  if (API_MODE === "remote") {
    await requestRemote(`/system/users/${encodeURIComponent(username)}`, { method: "DELETE" });
    return;
  }
  writeStore(readStore().filter((item) => item.username !== username));
}
