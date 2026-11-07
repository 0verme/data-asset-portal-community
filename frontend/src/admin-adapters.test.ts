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
const rolePage = read("./components/system/RoleManagementPage.tsx");
const ragConfigPage = read("./components/system/RagSearchConfigPanel.tsx");
const ragConfigApi = read("./api/ragSearchConfig.ts");
const aiLlmQuotaPage = read("./components/system/AiLlmDailyQuotaPanel.tsx");
const aiLlmQuotaApi = read("./api/aiLlmDailyQuota.ts");
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
  assert.equal((menuForm.match(/<Select<string>/g) ?? []).length, 2);
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

test("optional RAG configuration is admin-controlled and never fabricates answers", () => {
  assert.match(paramPage, /<RagSearchConfigPanel canEdit=\{canEdit\} \/>/);
  assert.match(ragConfigPage, /默认关闭/);
  assert.match(ragConfigPage, /普通关键词搜索不受影响/);
  assert.match(ragConfigPage, /LLM/);
  assert.match(ragConfigPage, /checked=\{config\.enabled\}/);
  assert.match(ragConfigPage, /disabled=\{!canEdit \|\| !supported/);
  assert.match(ragConfigApi, /\/system\/rag-search-config/);
  assert.match(ragConfigApi, /模拟模式不支持持久化 RAG 配置/);
  assert.match(ragConfigPage, /不生成智能解答/);
  assert.match(ragConfigPage, /HTTP Search Service v1/);
  assert.match(ragConfigPage, /DAP_RAG_SEARCH_MODE/);
  assert.match(ragConfigPage, /strategy 字段仅为兼容保留/);
  assert.doesNotMatch(ragConfigPage, /<select/);
  assert.doesNotMatch(ragConfigPage + ragConfigApi, /setAnswer|confidenceScore|similarityScore/);
});

test("daily LLM quota admin is remote-only, permission-aware, and documents shared usage", () => {
  assert.match(paramPage, /<AiLlmDailyQuotaPanel canEdit=\{canEdit\} \/>/);
  assert.match(aiLlmQuotaPage, /disabled=\{!canEdit \|\| !supported/);
  assert.match(aiLlmQuotaPage, /Asia\/Shanghai/);
  assert.match(aiLlmQuotaPage, /Mock \/ Remote/);
  assert.match(aiLlmQuotaPage, /system:param:write/);
  assert.match(aiLlmQuotaApi, /API_MODE === "remote"/);
  assert.match(aiLlmQuotaApi, /requestRemote\("\/system\/ai-llm-daily-quota"/);
  assert.match(aiLlmQuotaApi, /模拟模式不支持持久化每日 LLM 额度/);
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
