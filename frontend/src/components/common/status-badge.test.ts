import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { resolveStatusBadgePresentation } from "./statusBadge.ts";

const stateCardsPath = fileURLToPath(new URL("./StateCards.tsx", import.meta.url));

test("binary and legacy values keep their labels with semantic enabled/disabled tones", () => {
  assert.deepEqual(resolveStatusBadgePresentation({ status: "enabled" }), {
    label: "启用",
    tone: "success",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ status: "disabled" }), {
    label: "禁用",
    tone: "neutral",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ status: "active" }), {
    label: "启用",
    tone: "success",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ status: "inactive" }), {
    label: "禁用",
    tone: "neutral",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ on: false }), {
    label: "禁用",
    tone: "neutral",
  });
});

test("custom lifecycle metadata preserves its label and maps warning/error semantics", () => {
  const metaMap = {
    queued: { label: "待处理", className: "st-warn" },
    failed: { label: "失败", className: "st-off" },
  };

  assert.deepEqual(resolveStatusBadgePresentation({ status: "queued", metaMap }), {
    label: "待处理",
    tone: "warning",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ status: "failed", metaMap }), {
    label: "失败",
    tone: "danger",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ status: "error" }), {
    label: "error",
    tone: "danger",
  });
});

test("unknown values are never presented as enabled and use a neutral tone", () => {
  assert.deepEqual(resolveStatusBadgePresentation({ status: "unexpected-state" }), {
    label: "unexpected-state",
    tone: "neutral",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ status: null }), {
    label: "未知",
    tone: "neutral",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ on: "not-a-binary-value" }), {
    label: "not-a-binary-value",
    tone: "neutral",
  });
  assert.deepEqual(resolveStatusBadgePresentation({}), {
    label: "未知",
    tone: "neutral",
  });
});

test("explicit operation-result labels retain success and failure semantics", () => {
  assert.deepEqual(resolveStatusBadgePresentation({ on: true, label: "成功" }), {
    label: "成功",
    tone: "success",
  });
  assert.deepEqual(resolveStatusBadgePresentation({ on: false, label: "失败" }), {
    label: "失败",
    tone: "danger",
  });
});

test("StatusBadge delegates rendering to the DAP Status adapter", async () => {
  const source = await readFile(stateCardsPath, "utf8");
  assert.match(source, /import \{ Status as DAPStatus \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(source, /<DAPStatus tone=\{presentation\.tone\}>\{presentation\.label\}<\/DAPStatus>/);
  assert.doesNotMatch(source, /className=\{`tag \$\{tone\.tag\}`\}/);
});
