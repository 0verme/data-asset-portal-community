// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

import mockCommonCodes, { type CommonCodeItem } from "../data/commonCodes.ts";
import { REPORTS, type MockReportItem } from "../data/reports.ts";
import { optionsFromValues } from "../utils/optionUtils.ts";

function localCategoryValues(categoryCode: string): CommonCodeItem[] {
  const category = (mockCommonCodes.categories || []).find(
    (item) => item.code === categoryCode,
  );
  return (category?.items || []).filter((item) => item.active !== false);
}

function reportValues(reports: unknown[], key: string): string[] {
  return (Array.isArray(reports) ? reports : [])
    .map((item) => (item as Record<string, unknown>)?.[key])
    .filter((value): value is string => Boolean(String(value || "").trim()));
}

function mockReportValues(key: keyof MockReportItem): string[] {
  return REPORTS.map((item) => item?.[key]).filter(
    (value): value is string =>
      typeof value === "string" && Boolean(value.trim()),
  );
}

function actualOrLocal(
  reports: unknown[],
  key: string,
  categoryCode: string,
  mockKey?: keyof MockReportItem,
): Array<string | CommonCodeItem> {
  const actualValues = reportValues(reports, key);
  if (actualValues.length) return actualValues;
  const mockValues = mockReportValues(mockKey || (key as keyof MockReportItem));
  return mockValues.length ? mockValues : localCategoryValues(categoryCode);
}

export interface ReportOptionSets {
  reportTypes: Array<{ value: string; name?: string; label?: string }>;
  periods: Array<{ value: string; name?: string; label?: string }>;
  statCalibers: Array<{ value: string; name?: string; label?: string }>;
  dataDelays: Array<{ value: string; name?: string; label?: string }>;
  departments: Array<{ value: string; name?: string; label?: string }>;
}

export function buildReportOptionSets(
  reports: unknown[] = [],
): ReportOptionSets {
  const reportTypeValues = reportValues(reports, "type");
  return {
    // Report type is a report-asset domain value. Prefer the values returned by
    // /api/reports; the local list is only the existing mock-mode seed fallback.
    reportTypes: optionsFromValues(
      reportTypeValues.length
        ? reportTypeValues
        : [...mockReportValues("type"), ...localCategoryValues("REPORT_TYPE")],
    ),
    periods: optionsFromValues([
      ...actualOrLocal(reports, "statPeriod", "REPORT_STAT_PERIOD"),
      ...reportValues(reports, "freq"),
      ...localCategoryValues("REPORT_STAT_PERIOD"),
    ]),
    statCalibers: optionsFromValues([
      ...actualOrLocal(
        reports,
        "statCaliber",
        "REPORT_DATE_CALIBER",
        "dateCaliber",
      ),
      ...reportValues(reports, "dateCaliber"),
      ...localCategoryValues("REPORT_DATE_CALIBER"),
    ]),
    dataDelays: optionsFromValues([
      ...actualOrLocal(
        reports,
        "dataDelay",
        "REPORT_DATA_TIMELINESS",
        "dataTimeliness",
      ),
      ...reportValues(reports, "dataTimeliness"),
      ...localCategoryValues("REPORT_DATA_TIMELINESS"),
    ]),
    departments: optionsFromValues([
      ...reportValues(reports, "ownerDept"),
      ...localCategoryValues("UPSTREAM_DEPT"),
    ]),
  };
}
