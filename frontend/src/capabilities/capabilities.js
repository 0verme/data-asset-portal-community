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

import { listModuleCodes, resolveRepositoryModuleCodes } from "../modules/moduleRegistry.js";

function readApiMode() {
  try {
    return String(import.meta.env?.VITE_API_MODE || "mock").trim().toLowerCase();
  } catch (_error) {
    return "mock";
  }
}

/**
 * A capability contract request failure must not turn repository modules into
 * a fake 404. Deployment readiness may be unknown, while source-backed modules
 * stay navigable and can render their own dependency error state.
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
  // The current payload describes the source-backed module contract. Any
  // future dependency diagnostics must remain separate from this module set.
  const modules = openModuleItems();
  return {
    modules,
    // Retained field name: this is the source-backed module set, not a gate.
    enabledCodes: new Set(SAFE_FALLBACK_MODULES),
    // These fields describe the HTTP capability-contract loader only.
    loadStatus: "ready",
    loadError: null,
  };
}

export function buildMockCapabilities() {
  const enabledCodes = resolveRepositoryModuleCodes();
  return {
    modules: openModuleItems(),
    enabledCodes,
    loadStatus: "ready",
    loadError: null,
  };
}

export function buildSafeFallbackCapabilities(error) {
  const enabledCodes = new Set(SAFE_FALLBACK_MODULES);
  return {
    modules: openModuleItems(),
    enabledCodes,
    loadStatus: "error",
    loadError: error instanceof Error ? error.message : String(error || "capabilities unavailable"),
  };
}

/**
 * Load the public repository-module capability contract.
 * Remote and mock modes share the same repository module set. A failed remote
 * request only changes the HTTP loader's loadStatus/loadError; it never hides
 * source-backed routes or claims that a module is unavailable.
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
    console.error("Failed to load repository-module capability contract; using open module fallback.", error);
    return buildSafeFallbackCapabilities(error);
  }
}
