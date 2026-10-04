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
  type UpstreamFieldDefinition,
} from "./upstreamFieldContract.ts";

const fieldKeys = (fields: readonly UpstreamFieldDefinition[]): UpstreamFieldDefinition["key"][] =>
  fields.map(({ key }) => key);

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
      .filter(({ editable, visibility }) => editable && visibility !== "connection")
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
    "host",
    "db",
    "schema",
    "unloadTimes",
  ]);
  assert.deepEqual(fieldKeys(UPSTREAM_DETAIL_METADATA_FIELDS), [
    "id",
    "abbr",
    "dbType",
    "owner",
    "dept",
    "host",
    "db",
    "schema",
  ]);
  assert.ok(UPSTREAM_SYSTEM_FIELD_CONTRACT.some(({ key, detailLocations }) => key === "unloadTimes" && detailLocations.includes("schedule")));
});

test("connection metadata renders only when the active profile returns it", () => {
  const internal = getUpstreamDetailMetadata({
    id: "up_fulfillment",
    abbr: "FUL",
    dbType: "Kafka",
    host: "ful.demo.invalid",
    db: "DEMO_FUL",
    schema: "DEMO_FUL_OWNER",
  });
  const internalValues = new Map(internal.map(({ key, value }) => [key, value]));
  assert.equal(internalValues.get("host"), "ful.demo.invalid");
  assert.equal(internalValues.get("db"), "DEMO_FUL");
  assert.equal(internalValues.get("schema"), "DEMO_FUL_OWNER");

  const strict = getUpstreamDetailMetadata({
    id: "up_fulfillment",
    abbr: "FUL",
    dbType: "Kafka",
  });
  const strictKeys = strict.map(({ key }) => key);
  assert.ok(
    !strictKeys.includes("host") &&
      !strictKeys.includes("db") &&
      !strictKeys.includes("schema"),
    "strict payloads must not render connection metadata placeholders",
  );
  assert.ok(strict.every(({ value }) => value !== "undefined" && value !== "null"));
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
  const values = new Map(metadata.map(({ key, value }) => [key, value]));

  assert.equal(values.get("id"), "up_member");
  assert.equal(values.get("abbr"), "MEM");
  assert.equal(values.get("dbType"), "PostgreSQL");
  assert.equal(values.get("owner"), EMPTY_UPSTREAM_VALUE);
  assert.equal(values.get("dept"), EMPTY_UPSTREAM_VALUE);
  assert.doesNotMatch(JSON.stringify(Object.fromEntries(values)), /undefined|null/);
});
