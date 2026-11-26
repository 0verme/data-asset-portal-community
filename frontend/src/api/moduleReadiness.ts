/// <reference types="vite/client" />
import {
  buildModuleReadinessResult,
  getModuleReadinessSkeleton,
  normalizeReadinessModuleId,
  type ModuleReadinessResult,
  type ModuleReadinessStatus,
  type ReadinessWorkspaceModuleInput,
} from "../components/sidebar/common/moduleReadiness.ts";
import { getMockApiAssetReadinessCounts } from "./apiAssets.ts";
import { getMockAssetReadinessCounts } from "./assets.ts";
import { getMockFieldMappingReadinessCounts } from "./fieldMapping.ts";
import { requestRemote } from "./http.ts";
import { getMockIndicatorReadinessCounts } from "./indicator.ts";
import { getMockLineageTableCount } from "./lineage.ts";
import { getMockManualCodeTableReadinessCounts } from "./manualCodeTables.ts";
import { getMockPushJobReadinessCounts } from "./push.ts";
import { getMockReportReadinessCounts } from "./report.ts";
import { getMockRootReadinessCounts } from "./root.ts";

const API_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
).trim().toLowerCase();

const VALID_STATUSES: ReadonlySet<ModuleReadinessStatus> = new Set([
  "ready",
  "loading",
  "unavailable",
  "pending_definition",
  "pending_integration",
  "not_applicable",
]);

export function isRemoteReadinessMode(): boolean {
  return API_MODE === "remote";
}

export function getMockModuleReadiness(
  module: ReadinessWorkspaceModuleInput,
): ModuleReadinessResult {
  const moduleId = normalizeReadinessModuleId(module);
  switch (moduleId) {
    case "data-warehouse":
      return buildModuleReadinessResult(moduleId, getMockAssetReadinessCounts());
    case "mapping":
      return buildModuleReadinessResult(moduleId, getMockFieldMappingReadinessCounts());
    case "root":
      return buildModuleReadinessResult(moduleId, getMockRootReadinessCounts());
    case "indicator":
      return buildModuleReadinessResult(moduleId, getMockIndicatorReadinessCounts());
    case "codeTable":
      return buildModuleReadinessResult(moduleId, getMockManualCodeTableReadinessCounts());
    case "report":
      return buildModuleReadinessResult(moduleId, getMockReportReadinessCounts());
    case "apiAsset":
      return buildModuleReadinessResult(moduleId, getMockApiAssetReadinessCounts());
    case "push":
      return buildModuleReadinessResult(moduleId, getMockPushJobReadinessCounts());
    case "lineage": {
      const denominator = getMockAssetReadinessCounts().denominator;
      const numerator = Math.min(denominator, getMockLineageTableCount());
      return buildModuleReadinessResult(moduleId, { numerator, denominator });
    }
    case "system":
      return getModuleReadinessSkeleton("system");
  }
}

function normalizeRemoteReadinessItem(
  module: ReadinessWorkspaceModuleInput,
  payload: unknown,
): ModuleReadinessResult {
  const record = (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "data" in payload &&
    (payload as Record<string, unknown>)["data"] &&
    typeof (payload as Record<string, unknown>)["data"] === "object"
      ? (payload as Record<string, unknown>)["data"]
      : payload
  ) as Record<string, unknown> | null | undefined;

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return getModuleReadinessSkeleton(module, { status: "unavailable" });
  }

  const rawStatus = String(record["status"] || "").trim() as ModuleReadinessStatus;
  const status: ModuleReadinessStatus = VALID_STATUSES.has(rawStatus)
    ? rawStatus
    : "unavailable";
  const numerator = Number.isSafeInteger(record["numerator"])
    ? Number(record["numerator"])
    : null;
  const denominator = Number.isSafeInteger(record["denominator"])
    ? Number(record["denominator"])
    : null;
  const percentage =
    typeof record["percentage"] === "number" && Number.isFinite(record["percentage"])
      ? record["percentage"]
      : null;
  const definition =
    typeof record["definition"] === "string" && record["definition"].trim()
      ? record["definition"].trim()
      : getModuleReadinessSkeleton(module).definition;
  const updatedAt =
    typeof record["updatedAt"] === "string" && record["updatedAt"].trim()
      ? record["updatedAt"].trim()
      : null;

  return getModuleReadinessSkeleton(module, {
    status,
    definition,
    numerator,
    denominator,
    percentage,
    updatedAt,
  });
}

export async function getModuleReadiness(
  module: ReadinessWorkspaceModuleInput,
): Promise<ModuleReadinessResult> {
  const moduleId = normalizeReadinessModuleId(module);
  if (moduleId === "system") {
    return getModuleReadinessSkeleton("system");
  }
  if (!isRemoteReadinessMode()) {
    return getMockModuleReadiness(moduleId);
  }
  const payload = await requestRemote<unknown>("/portal/readiness", {
    params: { module: moduleId },
  });
  return normalizeRemoteReadinessItem(moduleId, payload);
}
