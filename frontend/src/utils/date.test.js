import assert from "node:assert/strict";
import test from "node:test";

import { formatDate, formatDateTime } from "./date.ts";

test("formatDateTime normalizes database and ISO timestamps to seconds", () => {
  assert.equal(formatDateTime("2026-07-13 09:35:00"), "2026-07-13 09:35:00");
  assert.equal(
    formatDateTime("2026-07-13 09:35:00.725"),
    "2026-07-13 09:35:00",
  );
  assert.equal(
    formatDateTime("2026-07-13 09:35:00.725617"),
    "2026-07-13 09:35:00",
  );
  assert.equal(
    formatDateTime("2026-07-13T09:35:00.725Z"),
    "2026-07-13 09:35:00",
  );
});

test("formatDateTime safely handles empty, invalid, and Date values", () => {
  assert.equal(formatDateTime(null), "-");
  assert.equal(formatDateTime(undefined), "-");
  assert.equal(formatDateTime(""), "-");
  assert.equal(formatDateTime("not a date"), "-");
  assert.equal(
    formatDateTime(new Date(2026, 6, 13, 9, 35, 0)),
    "2026-07-13 09:35:00",
  );
});

test("formatDate preserves date-only display", () => {
  assert.equal(formatDate("2026-07-13"), "2026-07-13");
  assert.equal(formatDate("2026-07-13T09:35:00.725Z"), "2026-07-13");
  assert.equal(formatDate(null), "-");
  assert.equal(formatDate("invalid"), "-");
});
