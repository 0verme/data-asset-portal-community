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

import { listModuleCodes, resolveDefaultEnabledModules } from "../modules/moduleRegistry.js";

function readApiMode() {
  try {
    return String(import.meta.env?.VITE_API_MODE || "mock").trim().toLowerCase();
  } catch (_error) {
    return "mock";
  }
}

/**
 * A capability request failure must not turn repository modules into a fake
 * 404. Deployment readiness may be unknown, while source-backed modules stay
 * navigable and can render their own dependency error state.
 */
export const SAFE_FALLBACK_MODULES = Object.freeze(listModuleCodes());

export function isRemoteCapabilitiesMode() {
  return readApiMode() === "remote";
}

function openModuleItems() {
  return listModuleCodes().map((code) => ({
    code,
    enabled: true,
    reason: null,
  }));
}

export function modulesFromPayload(_payload) {
  // Deployment readiness may be described by additional capability fields,
  // but the repository module set itself is always open.
  const modules = openModuleItems();
  return {
    modules,
    enabledCodes: new Set(SAFE_FALLBACK_MODULES),
    status: "ready",
    error: null,
  };
}

export function buildMockCapabilities() {
  const enabledCodes = resolveDefaultEnabledModules();
  return {
    modules: openModuleItems(),
    enabledCodes,
    status: "ready",
    error: null,
  };
}

export function buildSafeFallbackCapabilities(error) {
  const enabledCodes = new Set(SAFE_FALLBACK_MODULES);
  return {
    modules: openModuleItems(),
    enabledCodes,
    status: "error",
    error: error instanceof Error ? error.message : String(error || "capabilities unavailable"),
  };
}

/**
 * Load deployment capabilities.
 * Remote and mock modes share the same repository module set. A failed remote
 * request only changes readiness status; it never hides source-backed routes.
 */
export async function loadCapabilities() {
  if (!isRemoteCapabilitiesMode()) {
    return buildMockCapabilities();
  }
  try {
    const { requestRemote } = await import("../api/http.js");
    const payload = await requestRemote("/capabilities");
    return modulesFromPayload(payload);
  } catch (error) {
    console.error("Failed to load deployment capabilities; using open module fallback.", error);
    return buildSafeFallbackCapabilities(error);
  }
}
