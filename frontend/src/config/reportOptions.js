// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

import mockCommonCodes from "../data/commonCodes.js";
import { REPORTS } from "../data/reports.js";
import { optionsFromValues } from "../utils/optionUtils.js";

function localCategoryValues(categoryCode) {
  const category = (mockCommonCodes.categories || []).find((item) => item.code === categoryCode);
  return (category?.items || []).filter((item) => item.active !== false);
}

function reportValues(reports, key) {
  return (Array.isArray(reports) ? reports : [])
    .map((item) => item?.[key])
    .filter((value) => String(value || "").trim());
}

function mockReportValues(key) {
  return REPORTS.map((item) => item?.[key]).filter((value) => String(value || "").trim());
}

function actualOrLocal(reports, key, categoryCode, mockKey = key) {
  const actualValues = reportValues(reports, key);
  if (actualValues.length) return actualValues;
  const mockValues = mockReportValues(mockKey);
  return mockValues.length ? mockValues : localCategoryValues(categoryCode);
}

export function buildReportOptionSets(reports = []) {
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
      ...actualOrLocal(reports, "statCaliber", "REPORT_DATE_CALIBER", "dateCaliber"),
      ...reportValues(reports, "dateCaliber"),
      ...localCategoryValues("REPORT_DATE_CALIBER"),
    ]),
    dataDelays: optionsFromValues([
      ...actualOrLocal(reports, "dataDelay", "REPORT_DATA_TIMELINESS", "dataTimeliness"),
      ...reportValues(reports, "dataTimeliness"),
      ...localCategoryValues("REPORT_DATA_TIMELINESS"),
    ]),
    departments: optionsFromValues([
      ...reportValues(reports, "ownerDept"),
      ...localCategoryValues("UPSTREAM_DEPT"),
    ]),
  };
}
