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

import {
  listModuleCodes,
  resolveDefaultEnabledModules,
} from "../modules/moduleRegistry.js";

function readApiMode() {
  try {
    return String(import.meta.env?.VITE_API_MODE || "mock").trim().toLowerCase();
  } catch (_error) {
    return "mock";
  }
}

/** Safe default when remote capabilities fail — shell only, never all private modules. */
export const SAFE_FALLBACK_MODULES = Object.freeze(["portal"]);

export function isRemoteCapabilitiesMode() {
  return readApiMode() === "remote";
}

export function modulesFromPayload(payload) {
  const items = Array.isArray(payload?.modules) ? payload.modules : [];
  const enabled = new Set();
  for (const item of items) {
    if (item && item.enabled && item.code) enabled.add(item.code);
  }
  if (!enabled.has("portal")) enabled.add("portal");
  return {
    edition: payload?.edition || "private",
    modules: items,
    enabledCodes: enabled,
    status: "ready",
    error: null,
  };
}

export function buildMockCapabilities() {
  let envValue;
  try {
    envValue = import.meta.env?.VITE_ENABLED_MODULES;
  } catch (_error) {
    envValue = undefined;
  }
  const enabledCodes = resolveDefaultEnabledModules(envValue);
  const known = listModuleCodes();
  return {
    edition: "private",
    modules: known.map((code) => ({
      code,
      enabled: enabledCodes.has(code),
      reason: enabledCodes.has(code) ? null : "disabled_by_configuration",
    })),
    enabledCodes,
    status: "ready",
    error: null,
  };
}

export function buildSafeFallbackCapabilities(error) {
  const enabledCodes = new Set(SAFE_FALLBACK_MODULES);
  return {
    edition: "unknown",
    modules: listModuleCodes().map((code) => ({
      code,
      enabled: enabledCodes.has(code),
      reason: enabledCodes.has(code) ? null : "capabilities_unavailable",
    })),
    enabledCodes,
    status: "error",
    error: error instanceof Error ? error.message : String(error || "capabilities unavailable"),
  };
}

/**
 * Load instance capabilities.
 * Remote: GET /api/capabilities (never fall back to "all modules").
 * Mock: local default / VITE_ENABLED_MODULES.
 */
export async function loadCapabilities() {
  if (!isRemoteCapabilitiesMode()) {
    return buildMockCapabilities();
  }
  try {
    // Lazy import so Node unit tests can exercise pure helpers without Vite env.
    const { requestRemote } = await import("../api/http.js");
    const payload = await requestRemote("/capabilities");
    return modulesFromPayload(payload);
  } catch (error) {
    console.error("Failed to load module capabilities; using safe fallback.", error);
    return buildSafeFallbackCapabilities(error);
  }
}

export function isCapabilityEnabled(capabilities, code) {
  if (!capabilities?.enabledCodes) return false;
  return capabilities.enabledCodes.has(code);
}
