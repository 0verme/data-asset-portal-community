import assert from "node:assert/strict";
import test from "node:test";

import { isValidTime } from "./time.ts";

test("time validation accepts HH:mm boundaries and common values", () => {
  assert.equal(isValidTime("00:00"), true);
  assert.equal(isValidTime("08:30"), true);
  assert.equal(isValidTime("23:59"), true);
});

test("time validation rejects empty and malformed values", () => {
  assert.equal(isValidTime(""), false);
  assert.equal(isValidTime("8:30"), false);
  assert.equal(isValidTime("24:00"), false);
  assert.equal(isValidTime("12:60"), false);
});
