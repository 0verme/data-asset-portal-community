import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  BINARY_STATUS_LABELS,
  BINARY_STATUS_OPTIONS,
  getBinaryStatusValue,
  normalizeBinaryStatusLabel,
  normalizeBinaryStatusOptions,
  normalizeBinaryStatusValue,
} from "./common/status.ts";

const manualHookPath = fileURLToPath(
  new URL("../hooks/useManualCodeTableModule.ts", import.meta.url),
);
const manualPagePath = fileURLToPath(
  new URL("./ManualCodeTablePage.tsx", import.meta.url),
);
const manualApiPath = fileURLToPath(
  new URL("../api/manualCodeTables.ts", import.meta.url),
);
const manualDataPath = fileURLToPath(
  new URL("../data/manualCodeTables.ts", import.meta.url),
);

const read = (path) => readFile(path, "utf8");

test("binary status values and labels are canonical", () => {
  assert.deepEqual(BINARY_STATUS_LABELS, { enabled: "启用", disabled: "禁用" });
  assert.deepEqual(BINARY_STATUS_OPTIONS, [
    { value: "enabled", name: "启用" },
    { value: "disabled", name: "禁用" },
  ]);
  assert.equal(normalizeBinaryStatusValue("enabled"), "enabled");
  assert.equal(normalizeBinaryStatusValue("disabled"), "disabled");
  assert.equal(normalizeBinaryStatusLabel("enabled"), "启用");
  assert.equal(normalizeBinaryStatusLabel("disabled"), "禁用");
});

test("legacy binary values are read as canonical values without becoming options", () => {
  assert.equal(getBinaryStatusValue("active"), "enabled");
  assert.equal(getBinaryStatusValue("inactive"), "disabled");
  assert.equal(getBinaryStatusValue("draft"), "disabled");
  assert.equal(normalizeBinaryStatusLabel("停用"), "禁用");
  assert.equal(normalizeBinaryStatusLabel("已停用"), "禁用");

  assert.deepEqual(
    normalizeBinaryStatusOptions([
      { value: "active", name: "旧启用" },
      { value: "draft", name: "草稿" },
      { value: "inactive", name: "旧停用" },
      { value: "enabled", name: "启用" },
      { value: "disabled", name: "禁用" },
    ]),
    [
      { value: "enabled", name: "启用" },
      { value: "disabled", name: "禁用" },
    ],
  );
});

test("manual code table surfaces only expose the binary status contract", async () => {
  const [hook, page, api, data] = await Promise.all([
    read(manualHookPath),
    read(manualPagePath),
    read(manualApiPath),
    read(manualDataPath),
  ]);

  assert.match(hook, /enabled:\s*\{\s*label:\s*["']启用["']/);
  assert.match(hook, /disabled:\s*\{\s*label:\s*["']禁用["']/);
  assert.match(hook, /status:\s*["']enabled["']/);
  assert.doesNotMatch(
    hook,
    /status:\s*"active"|status\s*===\s*"active"|\bdraft\b|草稿|停用/,
  );
  assert.doesNotMatch(page, /value="active"|value="draft"|草稿|停用/);
  assert.match(page, /value="enabled">启用/);
  assert.match(page, /value="disabled">禁用/);
  assert.doesNotMatch(api, /\b(active|draft|inactive)\b|停用|草稿/);
  assert.doesNotMatch(data, /status:\s*"active"|status:\s*"draft"|停用|草稿/);
  assert.match(data, /status: "enabled"/);
});
