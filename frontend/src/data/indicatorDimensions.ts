// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

import type { IndicatorDimensionOption } from "./indicators.ts";
import { getIndicatorDimensionFromPath } from "./indicatorPathOptions.ts";

/**
 * A dimension code as reported by the backend dimension directory.
 *
 * The directory is discovered from indicator data, so the portal never needs a
 * static list of business dimensions. `label` comes from the parameter
 * dictionary / indicator path configuration and falls back to the raw code.
 */
export interface IndicatorDimensionCatalogEntry {
  code: string;
  label?: string | undefined;
  count?: number | undefined;
}

/** Short alphanumeric dimension code, matching `p_indicator_item.dimension_code`. */
const DIMENSION_CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;

/** Display label for indicators whose `dimension_code` is empty. */
export const UNASSIGNED_DIMENSION_LABEL = "未标注维度";

/**
 * Keep a real dimension code instead of collapsing it to an empty string.
 *
 * A dimension is user data, so only the generic storage format is validated.
 * This helper is the fallback for codes the frontend has no label for yet, so a
 * newly written business dimension is displayed with its own code rather than
 * being dropped.
 */
export function normalizeIndicatorDimensionCode(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || !DIMENSION_CODE_RE.test(raw)) return "";
  return raw.toLowerCase();
}

/**
 * Resolve the dimension of one indicator record.
 *
 * The demo-style path root wins so seeded rows keep their retail wording;
 * anything else keeps its real code (whatever the data uses, including codes
 * the frontend has never seen) instead of being collapsed into an empty
 * dimension. No industry vocabulary is assumed.
 */
export function resolveIndicatorDimension(
  path: unknown,
  dimension: unknown,
): string {
  return (
    getIndicatorDimensionFromPath(path) ||
    normalizeIndicatorDimensionCode(dimension)
  );
}

export function indicatorDimensionLabel(
  code: string,
  label?: string | undefined,
): string {
  const trimmed = String(label ?? "").trim();
  if (trimmed) return trimmed;
  return code ? code.toUpperCase() : UNASSIGNED_DIMENSION_LABEL;
}

export function indicatorDimensionCodeLabel(code: string): string {
  return code ? code.toUpperCase() : "--";
}

/**
 * Build sidebar/badge options from the dimension directory plus live facet counts.
 *
 * Counts are the ones derived from the same indicator list that backs the
 * "全部指标" total, so `sum(counts)` always equals that total. Codes present in
 * the data but missing from the directory are appended, never filtered out.
 */
export function buildIndicatorDimensionOptions(
  catalog: readonly IndicatorDimensionCatalogEntry[],
  counts: Record<string, number> = {},
): IndicatorDimensionOption[] {
  const labels = new Map<string, string>();
  const ordered: string[] = [];

  for (const entry of catalog ?? []) {
    const code = String(entry?.code ?? "").trim().toLowerCase();
    const label = String(entry?.label ?? "").trim();
    if (label) labels.set(code, label);
    if (ordered.includes(code)) continue;
    const hasData = counts[code] !== undefined || Number(entry?.count ?? 0) > 0;
    if (hasData) ordered.push(code);
  }

  const leftovers = Object.keys(counts)
    .filter((code) => !ordered.includes(code))
    .sort((left, right) => {
      const delta = (counts[right] || 0) - (counts[left] || 0);
      return delta !== 0 ? delta : left.localeCompare(right);
    });
  ordered.push(...leftovers);

  // "未标注维度" is a data-quality bucket rather than a business dimension, so
  // it stays at the bottom of the group instead of jumping on row count.
  const business = ordered.filter((code) => code !== "");
  const unassigned = ordered.filter((code) => code === "");

  return [...business, ...unassigned].map((code) => ({
    value: code,
    label: indicatorDimensionLabel(code, labels.get(code)),
    code: indicatorDimensionCodeLabel(code),
  }));
}

export function findIndicatorDimensionOption(
  options: readonly IndicatorDimensionOption[],
  dimension: string,
): IndicatorDimensionOption | undefined {
  return options.find((item) => item.value === dimension);
}
