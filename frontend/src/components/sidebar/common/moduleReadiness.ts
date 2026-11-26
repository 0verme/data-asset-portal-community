// The producer owns the definition and the canonical percentage for both DAP and the website.
export type ModuleReadinessStatus =
  | "ready"
  | "loading"
  | "unavailable"
  | "pending_definition"
  | "pending_integration"
  | "not_applicable";

export type ReadinessWorkspaceModuleInput =
  | "dwm"
  | "data-warehouse"
  | "mapping"
  | "root"
  | "indicator"
  | "codeTable"
  | "report"
  | "apiAsset"
  | "push"
  | "lineage"
  | "system";

export type ReadinessModuleId = Exclude<ReadinessWorkspaceModuleInput, "dwm">;

export type ReadinessMetricId =
  | "table_readiness"
  | "field_mapping_coverage"
  | "root_definition_readiness"
  | "metric_definition"
  | "code_table_readiness"
  | "report_asset_link"
  | "api_asset_link"
  | "push_job_readiness"
  | "lineage_snapshot_coverage";

export interface ModuleReadinessSpec {
  moduleId: ReadinessModuleId;
  metricId: ReadinessMetricId | null;
  defaultStatus: "pending_integration" | "not_applicable";
  primaryTable: string | null;
  denominatorRule: string | null;
  numeratorRule: string | null;
  definition: string | null;
}

export interface ModuleReadinessResult {
  moduleId: string;
  metricId: string | null;
  status: ModuleReadinessStatus;
  definition: string | null;
  numerator: number | null;
  denominator: number | null;
  percentage: number | null;
  updatedAt: string | null;
}

export const MODULE_READINESS_SPECS: Readonly<Record<ReadinessModuleId, ModuleReadinessSpec>> = {
  "data-warehouse": {
    moduleId: "data-warehouse",
    metricId: "table_readiness",
    defaultStatus: "pending_integration",
    primaryTable: "p_asset_table",
    denominatorRule: "is_deleted = 'N'",
    numeratorRule: "owner_name and table_desc are non-empty",
    definition: "计入：有负责人和表说明",
  },
  mapping: {
    moduleId: "mapping",
    metricId: "field_mapping_coverage",
    defaultStatus: "pending_integration",
    primaryTable: "p_field_mapping_field",
    denominatorRule: "active source fields in p_field_mapping_field",
    numeratorRule: "target_field_name and mapping_rule are configured",
    definition: "计入：已完成目标字段映射",
  },
  root: {
    moduleId: "root",
    metricId: "root_definition_readiness",
    defaultStatus: "pending_integration",
    primaryTable: "p_root_item",
    denominatorRule: "is_deleted = 'N'",
    numeratorRule: "root_en_name and root_desc are non-empty",
    definition: "计入：有英文全称和词根说明",
  },
  indicator: {
    moduleId: "indicator",
    metricId: "metric_definition",
    defaultStatus: "pending_integration",
    primaryTable: "p_indicator_item",
    denominatorRule: "is_deleted = 'N' AND status_code = 'enabled'",
    numeratorRule: "caliber_desc is non-empty and source_asset_id or result_table_name is bound",
    definition: "计入：有口径文本和出数表",
  },
  codeTable: {
    moduleId: "codeTable",
    metricId: "code_table_readiness",
    defaultStatus: "pending_integration",
    primaryTable: "p_manual_code_table",
    denominatorRule: "status_code = 'enabled'",
    numeratorRule: "owner_name and remark are non-empty",
    definition: "计入：有负责人和码表说明",
  },
  report: {
    moduleId: "report",
    metricId: "report_asset_link",
    defaultStatus: "pending_integration",
    primaryTable: "p_report_asset",
    denominatorRule: "is_deleted = 'N' AND status_code = 'enabled'",
    numeratorRule: "related_tables_json or related_indicators_json is non-empty",
    definition: "计入：已关联具体表或指标资产",
  },
  apiAsset: {
    moduleId: "apiAsset",
    metricId: "api_asset_link",
    defaultStatus: "pending_integration",
    primaryTable: "p_api_asset",
    denominatorRule: "is_deleted = 'N' AND status_code = 'enabled'",
    numeratorRule: "has at least one linked asset in p_api_relation",
    definition: "计入：已关联具体表或指标资产",
  },
  push: {
    moduleId: "push",
    metricId: "push_job_readiness",
    defaultStatus: "pending_integration",
    primaryTable: "p_push_job",
    denominatorRule: "is_deleted = 'N' AND enabled_flag = 'Y' under enabled p_push_system",
    numeratorRule: "source_path, target_path, and job_desc are non-empty",
    definition: "计入：已填写源/目标路径和作业说明",
  },
  lineage: {
    moduleId: "lineage",
    metricId: "lineage_snapshot_coverage",
    defaultStatus: "pending_integration",
    primaryTable: "p_asset_table",
    denominatorRule: "is_deleted = 'N' warehouse tables",
    numeratorRule: "warehouse tables covered by the active lineage snapshot",
    definition: "计入：已导入快照的表占比",
  },
  system: {
    moduleId: "system",
    metricId: null,
    defaultStatus: "not_applicable",
    primaryTable: null,
    denominatorRule: null,
    numeratorRule: null,
    definition: null,
  },
};

export function normalizeReadinessModuleId(module: ReadinessWorkspaceModuleInput): ReadinessModuleId {
  return module === "dwm" ? "data-warehouse" : module;
}

export function getModuleReadinessSpec(module: ReadinessWorkspaceModuleInput): ModuleReadinessSpec {
  return MODULE_READINESS_SPECS[normalizeReadinessModuleId(module)];
}

export function getModuleReadinessSkeleton(
  module: ReadinessWorkspaceModuleInput,
  overrides?: Partial<Omit<ModuleReadinessResult, "moduleId">>,
): ModuleReadinessResult {
  const spec = getModuleReadinessSpec(module);
  return {
    moduleId: spec.moduleId,
    metricId: spec.metricId,
    status: spec.defaultStatus,
    definition: spec.definition,
    numerator: null,
    denominator: null,
    percentage: null,
    updatedAt: null,
    ...overrides,
  };
}

export function buildModuleReadinessResult(
  module: ReadinessWorkspaceModuleInput,
  counts: { numerator: number; denominator: number; updatedAt?: string | null },
): ModuleReadinessResult {
  const spec = getModuleReadinessSpec(module);
  if (spec.defaultStatus === "not_applicable") {
    return getModuleReadinessSkeleton(module);
  }
  const { numerator, denominator, updatedAt = null } = counts;
  if (
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    !Number.isSafeInteger(numerator) ||
    numerator < 0
  ) {
    return getModuleReadinessSkeleton(module, {
      status: "unavailable",
      numerator: denominator === 0 ? 0 : null,
      denominator: denominator === 0 ? 0 : null,
      percentage: null,
      updatedAt,
    });
  }
  const clampedNumerator = Math.min(numerator, denominator);
  const percentage = Math.round((clampedNumerator * 1000) / denominator) / 10;
  return getModuleReadinessSkeleton(module, {
    status: "ready",
    numerator: clampedNumerator,
    denominator,
    percentage,
    updatedAt,
  });
}

export function readinessPercentage(result: ModuleReadinessResult): number | null {
  const { metricId, definition, numerator, denominator, percentage } = result;
  if (result.status !== "ready" || !metricId?.trim() || !definition?.trim()) return null;
  if (numerator === null || !Number.isSafeInteger(numerator) || numerator < 0) return null;
  if (denominator === null || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator > denominator) return null;
  if (percentage === null || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
  return percentage;
}
