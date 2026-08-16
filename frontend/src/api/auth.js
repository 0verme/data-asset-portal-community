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

function normalizeAuth(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!data || typeof data !== "object") {
    throw new Error("Invalid auth payload");
  }
  return {
    role: ["admin", "maintainer"].includes(data.role) ? data.role : "guest",
    user: data.user || null,
    name: data.name || null,
  };
}

export async function loginRemote({ username, password, remember }) {
  const payload = await requestRemote("/auth/login", {
    method: "POST",
    body: { username, password, remember },
  });
  return normalizeAuth(payload);
}

export async function getCurrentRemoteUser() {
  // 探测当前登录者：游客无会话时返回 401 属正常结果，
  // 不应触发全局 app:unauthorized（否则刷新就弹登录框）。
  const payload = await requestRemote("/auth/me", { suppressUnauthorizedEvent: true });
  return normalizeAuth(payload);
}

export async function logoutRemote() {
  await requestRemote("/auth/logout", {
    method: "POST",
  });
}
