import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_UPSTREAM_VALUE,
  UPSTREAM_DETAIL_FIELDS,
  UPSTREAM_DETAIL_METADATA_FIELDS,
  UPSTREAM_EDITABLE_BUSINESS_FIELDS,
  UPSTREAM_SYSTEM_FIELD_CONTRACT,
  displayUpstreamValue,
  getUpstreamDetailMetadata,
} from "./upstreamFieldContract.ts";

const fieldKeys = (fields) => fields.map(({ key }) => key);

test("ordinary editable upstream fields have a detail read location", () => {
  assert.deepEqual(fieldKeys(UPSTREAM_EDITABLE_BUSINESS_FIELDS), [
    "id",
    "abbr",
    "name",
    "dbType",
    "owner",
    "dept",
    "status",
    "desc",
  ]);
  assert.ok(UPSTREAM_EDITABLE_BUSINESS_FIELDS.every(({ detailLocations }) => detailLocations.length > 0));
  assert.ok(
    UPSTREAM_SYSTEM_FIELD_CONTRACT
      .filter(({ editable, sensitive }) => editable && !sensitive)
      .every(({ detailLocations }) => detailLocations.length > 0),
  );
  assert.deepEqual(fieldKeys(UPSTREAM_DETAIL_FIELDS), [
    "id",
    "abbr",
    "name",
    "dbType",
    "owner",
    "dept",
    "status",
    "desc",
    "unloadTimes",
  ]);
  assert.deepEqual(fieldKeys(UPSTREAM_DETAIL_METADATA_FIELDS), ["id", "abbr", "dbType", "owner", "dept"]);
  assert.ok(UPSTREAM_SYSTEM_FIELD_CONTRACT.some(({ key, detailLocations }) => key === "unloadTimes" && detailLocations.includes("schedule")));
});

test("upstream detail metadata uses a single empty-value fallback", () => {
  assert.equal(displayUpstreamValue(null), EMPTY_UPSTREAM_VALUE);
  assert.equal(displayUpstreamValue(undefined), EMPTY_UPSTREAM_VALUE);
  assert.equal(displayUpstreamValue(""), EMPTY_UPSTREAM_VALUE);
  assert.equal(displayUpstreamValue("   "), EMPTY_UPSTREAM_VALUE);
  assert.equal(displayUpstreamValue("演示数据维护组"), "演示数据维护组");

  const metadata = getUpstreamDetailMetadata({
    id: "up_member",
    abbr: "MEM",
    dbType: "PostgreSQL",
    owner: null,
    dept: "",
  });
  const values = Object.fromEntries(metadata.map(({ key, value }) => [key, value]));

  assert.equal(values.id, "up_member");
  assert.equal(values.abbr, "MEM");
  assert.equal(values.dbType, "PostgreSQL");
  assert.equal(values.owner, EMPTY_UPSTREAM_VALUE);
  assert.equal(values.dept, EMPTY_UPSTREAM_VALUE);
  assert.doesNotMatch(JSON.stringify(values), /undefined|null/);
});
