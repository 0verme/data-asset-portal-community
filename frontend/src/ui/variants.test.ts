import assert from "node:assert/strict";
import test from "node:test";

import {
  BADGE_TONE_MAP,
  BUTTON_VARIANT_MAP,
  CONTROL_SIZE_MAP,
  GRID_COLUMNS_MAP,
  GRID_DENSITY_MAP,
  TAB_APPEARANCE_MAP,
} from "./variants.ts";

test("DAP control sizes keep medium at Kumo base and compact at Kumo small", () => {
  assert.deepEqual(CONTROL_SIZE_MAP, { sm: "sm", md: "base" });
});

test("DAP button and badge semantics map explicitly to Kumo variants", () => {
  assert.deepEqual(BUTTON_VARIANT_MAP, {
    primary: "primary",
    secondary: "secondary",
    tertiary: "ghost",
    danger: "secondary-destructive",
    outline: "outline",
  });
  assert.deepEqual(BADGE_TONE_MAP, {
    brand: "primary",
    neutral: "secondary",
    success: "success",
    warning: "warning",
    danger: "error",
    info: "info",
  });
});

test("DAP layout vocabulary maps to stable compact Kumo defaults", () => {
  assert.deepEqual(TAB_APPEARANCE_MAP, { line: "underline", segmented: "segmented" });
  assert.deepEqual(GRID_COLUMNS_MAP, { 2: "2up", 3: "3up", 4: "4up", 6: "6up" });
  assert.deepEqual(GRID_DENSITY_MAP, { compact: "sm", normal: "base", spacious: "lg" });
});
