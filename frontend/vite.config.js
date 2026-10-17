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

import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

export function resolveFrontendApiMode(env, command) {
  const mode = env.VITE_API_MODE?.trim().toLowerCase();
  if (mode && !["remote", "mock"].includes(mode)) {
    throw new Error("VITE_API_MODE must be remote or mock");
  }
  if (command === "build" && mode !== "remote") {
    throw new Error("Production builds require explicit VITE_API_MODE=remote; use the dev server for Mock");
  }
  return mode || "mock";
}

function resolveFrontendApiBaseUrl(env) {
  return (env.VITE_API_BASE_URL?.trim() || "/api").replace(/\/$/, "") || "/api";
}

function resolveBackendTarget(env) {
  return (env.VITE_BACKEND_URL?.trim() || "http://127.0.0.1:15099").replace(/\/$/, "");
}

function buildApiProxyKey(apiBaseUrl) {
  const escapedBaseUrl = apiBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escapedBaseUrl}(?:/|$)`;
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiMode = resolveFrontendApiMode(env, command);
  const apiBaseUrl = resolveFrontendApiBaseUrl(env);
  const backendTarget = resolveBackendTarget(env);

  return {
    plugins: [react()],
    server: {
      fs: {
        allow: [
          searchForWorkspaceRoot(process.cwd()),
          fileURLToPath(new URL("../config", import.meta.url)),
          fileURLToPath(new URL("../demo", import.meta.url)),
        ],
      },
      proxy: apiMode === "remote" ? {
        [buildApiProxyKey(apiBaseUrl)]: {
          target: backendTarget,
          changeOrigin: true,
        },
      } : undefined,
    },
    define: {
      "import.meta.env.VITE_API_MODE": JSON.stringify(apiMode),
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
    },
  };
});
