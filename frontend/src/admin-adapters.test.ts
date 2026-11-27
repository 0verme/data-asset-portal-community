import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const userForm = read("./components/system/UserForm.tsx");
const menuForm = read("./components/system/MenuForm.tsx");
const paramForm = read("./components/system/ParamForm.tsx");
const userPage = read("./components/system/UserManagementPage.tsx");
const menuPage = read("./components/system/MenuManagementPage.tsx");
const paramPage = read("./components/system/ParamDictPage.tsx");
const systemPage = read("./components/system/SystemManagementPage.tsx");
const aiManagementPage = read("./components/system/AiManagementPage.tsx");
const siteBrandingPage = read("./components/system/SiteBrandingPage.tsx");
const portalRecommendationsPage = read("./components/system/PortalRecommendationsPage.tsx");
const systemView = read("./components/views/SystemView.tsx");
const systemSidebar = read("./components/sidebar/SystemSidebar.tsx");
const rolePage = read("./components/system/RoleManagementPage.tsx");
const ragConfigPage = read("./components/system/RagSearchConfigPanel.tsx");
const ragConfigApi = read("./api/ragSearchConfig.ts");
const aiLlmQuotaPage = read("./components/system/AiLlmDailyQuotaPanel.tsx");
const aiLlmQuotaApi = read("./api/aiLlmDailyQuota.ts");
const zhCommon = JSON.parse(read("./i18n/locales/zh-CN/common.json")) as Record<string, unknown>;
const enCommon = JSON.parse(read("./i18n/locales/en-US/common.json")) as Record<string, unknown>;
const oplogPage = read("./components/OperationLog/OperationLogPage.tsx");
const oplogFilter = read("./components/OperationLog/OperationLogFilter.tsx");
const oplogDetail = read("./components/OperationLog/OperationLogDetail.tsx");

test("system forms use the frozen DAP adapters", () => {
  assert.match(userForm, /import \{ Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((userForm.match(/<Input/g) ?? []).length, 3);
  assert.equal((userForm.match(/<Select<string>/g) ?? []).length, 1);
  assert.equal((userForm.match(/<Textarea/g) ?? []).length, 1);

  assert.match(menuForm, /import \{ Checkbox, FormErrorSummary, FormField, focusFirstFormError, Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((menuForm.match(/<Input/g) ?? []).length, 4);
  assert.equal((menuForm.match(/<Select<string>/g) ?? []).length, 1);
  assert.equal((menuForm.match(/<Checkbox/g) ?? []).length, 1);
  assert.equal((menuForm.match(/<Textarea/g) ?? []).length, 1);

  assert.match(paramForm, /import \{ FormErrorSummary, FormField, focusFirstFormError, Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((paramForm.match(/<Input/g) ?? []).length, 3);
  assert.equal((paramForm.match(/<Select<string>/g) ?? []).length, 1);
  assert.match(paramForm, /placeholder="请选择分类"/);
});

test("system pages use the frozen DAP adapters with documented native exceptions", () => {
  assert.match(userPage, /<Button className="btn primary" variant="primary"/);
  assert.match(menuPage, /<Button className="btn primary" variant="primary"/);
  assert.equal((menuPage.match(/<IconButton/g) ?? []).length, 2);
  assert.doesNotMatch(menuPage, /<button/);
  assert.match(paramPage, /<Button className="btn primary" variant="primary"/);
  assert.doesNotMatch(paramPage, /BrandingConfigPanel|AiLlmDailyQuotaPanel|RagSearchConfigPanel/);
  assert.equal((paramPage.match(/<button/g) ?? []).length, 1, "category list item stays native");
  assert.match(systemPage, /<Button className="btn state-btn" variant="secondary"/);
  assert.match(rolePage, /import \{ Button, FormErrorSummary, FormField, focusFirstFormError, Input, TablePagination, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((rolePage.match(/<Input/g) ?? []).length, 2);
  assert.equal((rolePage.match(/<Textarea/g) ?? []).length, 1);
  assert.equal((rolePage.match(/<input/g) ?? []).length, 1, "permission matrix checkbox stays native");
  assert.match(userPage, /<TablePagination[\s\S]*?ariaLabel="用户管理分页"/);
  assert.match(rolePage, /<TablePagination[\s\S]*?ariaLabel="角色管理分页"/);
  assert.match(menuPage, /<TablePagination[\s\S]*?ariaLabel="菜单管理分页"/);
  assert.match(paramPage, /<TablePagination[\s\S]*?ariaLabel="参数字典明细分页"/);
});

test("AI management is an independent system page and reuses the existing panels", () => {
  assert.match(aiManagementPage, /<AiLlmDailyQuotaPanel canEdit=\{canEdit\} \/>/);
  assert.match(aiManagementPage, /<RagSearchConfigPanel canEdit=\{canEdit\} \/>/);
  assert.match(aiManagementPage, /aiManagement\.title/);
  assert.match(systemView, /<AiManagementPage canEdit=\{canManageParams\} \/>/);
  assert.match(systemSidebar, /page: "ai", label: t\("systemManagement\.ai"\), visible: canViewParams/);
  assert.match(systemSidebar, /onClick=\{\(\) => setSystemRoute\(\{ page \}\)\}/);
  assert.match(systemSidebar, /systemManagement\.ai/);
  assert.match(systemView, /canViewParams/);
  assert.match(aiManagementPage, /aiManagement\.readOnly/);
});

test("site branding has an independent system page", () => {
  assert.match(siteBrandingPage, /<BrandingConfigPanel canEdit=\{canEdit\} \/>/);
  assert.match(systemView, /<SiteBrandingPage canEdit=\{canManageParams\} \/>/);
  assert.match(systemSidebar, /page: "branding", label: t\("systemManagement\.branding"\), visible: canViewParams/);
  assert.match(systemSidebar, /onClick=\{\(\) => setSystemRoute\(\{ page \}\)\}/);
  assert.match(systemSidebar, /systemManagement\.branding/);
  assert.doesNotMatch(paramPage, /branding|Branding/i);
});

test("portal recommendations has an independent system page backed by p_search_hot_keyword", () => {
  assert.match(portalRecommendationsPage, /PORTAL_AI_EXAMPLE_CATEGORY/);
  assert.doesNotMatch(portalRecommendationsPage, /p_search_hot_keyword/);
  assert.match(systemView, /<PortalRecommendationsPage query=\{query\} canEdit=\{canManageParams\} \/>/);
  assert.match(systemSidebar, /page: "search-recommendations", label: t\("systemManagement\.searchRecommendations"\), visible: canViewParams/);
});

test("RAG settings stay admin-controlled and preserve existing parameter contract", () => {
  assert.match(ragConfigPage, /checked=\{config\.enabled\}/);
  assert.match(ragConfigPage, /aiManagement\.rag\.retrievalMode/);
  assert.match(ragConfigPage, /aiManagement\.rag\.retrievalModeDescription/);
  assert.match(ragConfigPage, /disabled=\{!canEdit \|\| !supported/);
  assert.match(ragConfigApi, /retrievalMode: "local"/);
  assert.match(ragConfigApi, /retrievalMode: config\.retrievalMode/);
  assert.match(ragConfigApi, /config\.serviceUrl \? \{ serviceUrl: config\.serviceUrl \} : \{\}/);
  assert.match(ragConfigApi, /\/system\/rag-search-config/);
  assert.match(ragConfigApi, /模拟模式不支持持久化 RAG 配置/);
  assert.match(ragConfigPage, /aiManagement\.rag\.strategyValuesDescription/);
  assert.match(ragConfigPage, /aiManagement\.rag\.topKRange/);
  assert.match(ragConfigPage, /aiManagement\.rag\.timeoutRange/);
  assert.doesNotMatch(ragConfigPage, /<select/);
  assert.doesNotMatch(ragConfigPage + ragConfigApi, /setAnswer|confidenceScore|similarityScore/);
});

test("daily AI quota keeps the same key and does not invent usage in mock or error states", () => {
  assert.match(aiLlmQuotaPage, /disabled=\{!canEdit \|\| !supported/);
  assert.match(aiLlmQuotaPage, /usageAvailable \? \(/);
  assert.match(aiLlmQuotaPage, /aiManagement\.quota\.noUsageStats/);
  assert.match(aiLlmQuotaPage, /aiManagement\.quota\.resetTime/);
  assert.match(aiLlmQuotaApi, /API_MODE === "remote"/);
  assert.match(aiLlmQuotaApi, /parameterCode: "AI_LLM_DAILY_LIMIT"/);
  assert.match(aiLlmQuotaApi, /requestRemote\("\/system\/ai-llm-daily-quota"/);
  assert.match(aiLlmQuotaApi, /模拟模式不支持持久化每日 AI 问答额度/);
});

test("AI management and branding strings have matching Chinese and English keys", () => {
  const keys = (value: unknown, prefix = ""): string[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
    return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
  };
  for (const namespace of ["systemManagement", "aiManagement"] as const) {
    assert.deepEqual(keys(zhCommon[namespace]).sort(), keys(enCommon[namespace]).sort(), `${namespace} translations must stay in sync`);
  }
  assert.equal(typeof (zhCommon["branding"] as Record<string, unknown>)["pageTitle"], "string");
  assert.equal(typeof (enCommon["branding"] as Record<string, unknown>)["pageTitle"], "string");
});

test("operation log surfaces use the frozen DAP adapters", () => {
  assert.equal((oplogPage.match(/<Button/g) ?? []).length, 1);
  assert.match(oplogPage, /<TablePagination[\s\S]*?ariaLabel="操作日志分页"/);
  assert.match(oplogFilter, /import \{ Button, Input, Select \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((oplogFilter.match(/<Select<string>/g) ?? []).length, 3);
  assert.equal((oplogFilter.match(/<Input/g) ?? []).length, 2);
  assert.match(oplogFilter, /type="datetime-local"/);
  assert.match(oplogDetail, /<Button className="btn" variant="secondary"/);

  [userForm, menuForm, paramForm, userPage, menuPage, paramPage, systemPage, rolePage, oplogPage, oplogFilter, oplogDetail].forEach((source) => {
    assert.doesNotMatch(source, /from "@cloudflare\/kumo\//);
  });
});
