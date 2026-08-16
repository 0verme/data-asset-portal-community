import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

function render(AssetRisksPanel, assetRisks) {
  return renderToStaticMarkup(React.createElement(AssetRisksPanel, { assetRisks }));
}

function assertIncludes(markup, text) {
  assert.ok(markup.includes(text), `Expected rendered markup to include: ${text}`);
}

function assertExcludes(markup, text) {
  assert.ok(!markup.includes(text), `Expected rendered markup to exclude: ${text}`);
}

try {
  const { AssetRisksPanel } = await server.ssrLoadModule("/src/components/AssetRisksPanel.jsx");

  const undefinedMarkup = render(AssetRisksPanel, undefined);
  assertIncludes(undefinedMarkup, "当前暂无资产风险");
  assertIncludes(undefinedMarkup, ">0<");

  const emptyMarkup = render(AssetRisksPanel, []);
  assertIncludes(emptyMarkup, "当前暂无资产风险");
  assertIncludes(emptyMarkup, ">0<");

  const fullMarkup = render(AssetRisksPanel, [
    {
      risk_id: "risk-1",
      severity: "error",
      risk_source: "portal",
      asset_name: "DWS_CUSTOMER",
      rule_code: "ASSET_OWNER_REQUIRED",
      rule_name: "负责人缺失",
      message: "资产负责人不能为空",
      suggestion: "请补充负责人",
      action_url: "https://example.test/assets/risk-1",
      created_at: "2026-07-05 10:00:00",
    },
    {
      risk_id: "risk-2",
      severity: "warning",
      risk_source: "code_audit",
      asset_key: "DWS_ORDER",
      rule_code: "DDL_REVIEW",
      rule_name: "DDL 待复核",
      message: "字段注释需要复核",
      action_url: "",
    },
    {
      risk_id: "risk-3",
      severity: "info",
      risk_source: "manual",
      asset_name: "DWS_PAY",
      rule_code: "MANUAL_NOTE",
      rule_name: "人工提示",
      message: "请关注使用频率",
    },
    {
      risk_id: "risk-4",
      severity: "info",
      risk_source: "import",
      asset_name: "DWS_IMPORT",
      rule_code: "IMPORT_NOTE",
      rule_name: "导入提示",
      message: "导入元数据已同步",
    },
    {
      risk_id: "risk-5",
      severity: "info",
      risk_source: "external",
      asset_name: "DWS_EXTERNAL",
      rule_code: "EXT_NOTE",
      rule_name: "外部提示",
      message: "外部系统提示",
    },
  ]);
  assertIncludes(fullMarkup, ">5<");
  assertIncludes(fullMarkup, "严重");
  assertIncludes(fullMarkup, "警告");
  assertIncludes(fullMarkup, "提示");
  assertIncludes(fullMarkup, "资产门户");
  assertIncludes(fullMarkup, "代码审计");
  assertIncludes(fullMarkup, "人工");
  assertIncludes(fullMarkup, "导入");
  assertIncludes(fullMarkup, "外部");
  assertIncludes(fullMarkup, "负责人缺失");
  assertIncludes(fullMarkup, "资产负责人不能为空");
  assertIncludes(fullMarkup, "请补充负责人");
  assertIncludes(fullMarkup, "去处理");
  assertIncludes(fullMarkup, "https://example.test/assets/risk-1");

  const missingFieldsMarkup = render(AssetRisksPanel, [
    {
      risk_id: "risk-missing-fields",
      severity: "warning",
      risk_source: "portal",
      rule_code: "MISSING_FIELDS",
      asset_key: "DWS_SAFE",
      message: "缺少部分字段时仍应展示",
    },
  ]);
  assertIncludes(missingFieldsMarkup, "未命名规则");
  assertIncludes(missingFieldsMarkup, "缺少部分字段时仍应展示");
  assertExcludes(missingFieldsMarkup, "去处理");

  const unsafeActionMarkup = render(AssetRisksPanel, [
    {
      risk_id: "risk-unsafe-url",
      severity: "warning",
      risk_source: "portal",
      rule_code: "UNSAFE_URL",
      rule_name: "非安全链接",
      message: "javascript 链接不应渲染按钮",
      action_url: "javascript:alert(1)",
    },
  ]);
  assertExcludes(unsafeActionMarkup, "去处理");
  assertExcludes(unsafeActionMarkup, "javascript:alert");
} finally {
  await server.close();
}
