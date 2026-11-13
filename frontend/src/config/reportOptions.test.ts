import assert from "node:assert/strict";
import test from "node:test";

import { buildReportOptionSets } from "./reportOptions.ts";
import type { RemoteReportOptions } from "../api/report.ts";

const authoritativeOptions: RemoteReportOptions = {
  reportTypes: ["CLIMATE_SUMMARY", "RESOURCE_INVENTORY", "CLIMATE_SUMMARY"],
  periods: ["P7", "P30", "P7"],
  statCalibers: ["source_event", "observation_window"],
  dataDelays: ["T+9"],
  departments: ["North region", "Field operations"],
};

test("Remote report candidates are available with an empty report collection", () => {
  const options = buildReportOptionSets([], authoritativeOptions);

  assert.deepEqual(options.reportTypes.map((item) => item.value), [
    "CLIMATE_SUMMARY",
    "RESOURCE_INVENTORY",
  ]);
  assert.deepEqual(options.periods.map((item) => item.value), ["P7", "P30"]);
  assert.deepEqual(options.statCalibers.map((item) => item.value), [
    "source_event",
    "observation_window",
  ]);
  assert.deepEqual(options.dataDelays.map((item) => item.value), ["T+9"]);
  assert.deepEqual(options.departments.map((item) => item.value), [
    "North region",
    "Field operations",
  ]);
});

test("Remote report candidates retain unique historical values after authoritative values", () => {
  const options = buildReportOptionSets(
    [
      {
        type: "CLIMATE_SUMMARY",
        statPeriod: "P7",
        freq: "P90",
        statCaliber: "legacy_caliber",
        dateCaliber: "legacy_date_caliber",
        dataDelay: "T+12",
        dataTimeliness: "legacy_timeliness",
        ownerDept: "Legacy department",
      },
    ],
    authoritativeOptions,
  );

  assert.deepEqual(options.reportTypes.map((item) => item.value), [
    "CLIMATE_SUMMARY",
    "RESOURCE_INVENTORY",
  ]);
  assert.deepEqual(options.periods.map((item) => item.value), ["P7", "P30", "P90"]);
  assert.deepEqual(options.statCalibers.map((item) => item.value), [
    "source_event",
    "observation_window",
    "legacy_caliber",
    "legacy_date_caliber",
  ]);
  assert.deepEqual(options.dataDelays.map((item) => item.value), [
    "T+9",
    "T+12",
    "legacy_timeliness",
  ]);
  assert.deepEqual(options.departments.map((item) => item.value), [
    "North region",
    "Field operations",
    "Legacy department",
  ]);
});

test("Remote report candidates never fall back to local demonstration dictionaries", () => {
  const options = buildReportOptionSets([], undefined);
  const values = [
    ...options.reportTypes.map((item) => item.value),
    ...options.periods.map((item) => item.value),
    ...options.statCalibers.map((item) => item.value),
    ...options.dataDelays.map((item) => item.value),
    ...options.departments.map((item) => item.value),
  ];

  assert.deepEqual(values, []);
});
