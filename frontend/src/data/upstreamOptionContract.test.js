import assert from "node:assert/strict";
import test from "node:test";

import {
  UPSTREAM_DB_TYPE_OPTIONS,
  UPSTREAM_DEPT_OPTIONS,
} from "./commonCodes.ts";
import {
  displayDictValue,
  findDictOption,
  normalizeDictOptions,
  normalizeDictValue,
} from "../utils/optionUtils.ts";

const dbTypeOptions = normalizeDictOptions(UPSTREAM_DB_TYPE_OPTIONS);
const deptOptions = normalizeDictOptions(UPSTREAM_DEPT_OPTIONS);

test("upstream options keep display labels and submitted values explicit", () => {
  const dbType = findDictOption(dbTypeOptions, "PostgreSQL");
  const dept = findDictOption(deptOptions, "供应链部");

  assert.deepEqual(
    { label: dbType?.name, value: dbType?.value, code: dbType?.code },
    { label: "PostgreSQL", value: "PostgreSQL", code: "POSTGRESQL" },
  );
  assert.deepEqual(
    { label: dept?.name, value: dept?.value, code: dept?.code },
    { label: "供应链部", value: "供应链部", code: "SUPPLY_CHAIN" },
  );
});

test("upstream form submission normalizes option codes to the storage values", () => {
  const payload = {
    dbType: normalizeDictValue(dbTypeOptions, "POSTGRESQL"),
    dept: normalizeDictValue(deptOptions, "SUPPLY_CHAIN"),
  };

  assert.deepEqual(payload, {
    dbType: "PostgreSQL",
    dept: "供应链部",
  });
  assert.equal(displayDictValue(dbTypeOptions, "POSTGRESQL"), "PostgreSQL");
  assert.equal(displayDictValue(deptOptions, "SUPPLY_CHAIN"), "供应链部");
});

test("upstream option matching is case-insensitive and preserves unknown history", () => {
  assert.equal(normalizeDictValue(dbTypeOptions, " postgresql "), "PostgreSQL");
  assert.equal(displayDictValue(deptOptions, "历史部门"), "历史部门");
});
