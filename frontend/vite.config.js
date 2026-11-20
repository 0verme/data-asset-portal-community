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
import { appearanceBootstrap } from "./appearance-bootstrap.js";
import { assertPackageReleaseVersion, resolveReleaseMetadata } from "./scripts/release-metadata.mjs";

export function resolveFrontendApiMode(env, command) {
  const mode = env.VITE_API_MODE?.trim().toLowerCase();
  if (mode && !["remote", "mock"].includes(mode)) {
    throw new Error("VITE_API_MODE must be remote or mock");
  }
  if (command === "build" && mode !== "remote" && !(mode === "mock" && env.DAP_STATIC_MOCK_BUILD === "1")) {
    throw new Error("Production builds require VITE_API_MODE=remote; static Mock builds additionally require VITE_API_MODE=mock DAP_STATIC_MOCK_BUILD=1");
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

function buildBrandingProxyKey() {
  return "^/static/branding/[0-9a-f]{64}\\.(?:png|svg)$";
}

// Kumo uses data-mode for its resolved color scheme. Map DAP's resolved
// root attribute while preserving Kumo's own nested mode selectors.
function kumoResolvedTheme() {
  return {
    name: "dap-kumo-resolved-theme",
    enforce: "pre",
    transform(source, id) {
      if (!id.endsWith("/@cloudflare/kumo/dist/styles/kumo-standalone.css")) return;
      return source.replaceAll("[data-mode=dark]", ":is([data-mode=dark], :where(html)[data-theme=dark])");
    },
  };
}

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiMode = resolveFrontendApiMode(env, command);
  const apiBaseUrl = resolveFrontendApiBaseUrl(env);
  const backendTarget = resolveBackendTarget(env);
  const releaseMetadata = await resolveReleaseMetadata({ env: { ...env, ...process.env } });
  if (!["override", "release-event"].includes(releaseMetadata.source)) {
    await assertPackageReleaseVersion(releaseMetadata.version);
  }

  return {
    plugins: [react(), appearanceBootstrap(), kumoResolvedTheme()],
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
        [buildBrandingProxyKey()]: {
          target: backendTarget,
          changeOrigin: true,
        },
      } : undefined,
    },
    define: {
      "import.meta.env.VITE_API_MODE": JSON.stringify(apiMode),
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
      __DAP_RELEASE_METADATA__: JSON.stringify({
        version: releaseMetadata.version,
        releaseUrl: releaseMetadata.releaseUrl,
        repositoryUrl: releaseMetadata.repositoryUrl,
      }),
    },
  };
});
