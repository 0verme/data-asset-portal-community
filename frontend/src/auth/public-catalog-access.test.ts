import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const src = fileURLToPath(new URL("..", import.meta.url));
const read = (relativePath: string) => readFile(`${src}/${relativePath}`, "utf8");

test("remote auth bootstrap treats /auth/me 401 as anonymous public-catalog access", async () => {
  const [app, search, moduleContent] = await Promise.all([
    read("App.tsx"),
    read("components/SearchPortalPage.tsx"),
    read("components/app/ModuleContent.tsx"),
  ]);

  assert.match(app, /businessAccessReady = \(!isDbAuthMode\(\) \|\| authReady\) && publicCatalogConfigReady/);
  assert.match(app, /catalogAccessDisabled = publicCatalogConfig\.profile === "disabled" && !auth\.user/);
  assert.match(app, /navMenus = getNavigationMenusForAuth\(navMenuSnapshot, navigationAuthKey\)/);
  assert.match(app, /if \(!catalogDataAccessReady\)\s*\{\s*navMenuRequestRef\.current \+= 1;\s*setNavMenuSnapshot\(\{ authKey: navigationAuthKey, menus: \[\] \}\)/);
  assert.match(app, /loadMenus\(navigationAuthKey\)/);
  assert.match(search, /publicAccessReady = true/);
  assert.doesNotMatch(search, /请先登录后搜索/);
  assert.doesNotMatch(moduleContent, /AuthenticatedBusinessPrompt/);
  assert.match(moduleContent, /publicAccessReady=\{context\.businessAccessReady\}/);
  assert.match(moduleContent, /匿名目录访问已关闭/);
});

test("anonymous UI exposes catalog actions only and keeps write controls permission-gated", async () => {
  const sources = await Promise.all([
    read("components/views/AssetView.tsx"),
    read("components/IndicatorPage.tsx"),
    read("components/report/ReportList.tsx"),
    read("components/views/ApiAssetView.tsx"),
    read("components/views/UpstreamView.tsx"),
    read("components/views/PushView.tsx"),
    read("components/RootPages.tsx"),
  ]);

  for (const source of sources) assert.match(source, /canEdit/);
  const gatedButton = /canEdit\s*\?\s*\(?\s*<(?:button|Button)/;
  assert.match(sources[0], gatedButton);
  assert.match(sources[1], gatedButton);
  assert.match(sources[2], gatedButton);
  assert.match(sources[3], gatedButton);
  assert.match(sources[4], /onNew=\{\s*canEdit\s*\?/);
  assert.match(sources[5], gatedButton);
  assert.match(sources[6], gatedButton);
});

test("anonymous CSV export stays hidden unless the server explicitly enables it", async () => {
  const [moduleContent, codeTables, mappings, codeSidebar, mappingSidebar, mappingApi, codeTableApi, codeTableHook] = await Promise.all([
    read("components/app/ModuleContent.tsx"),
    read("components/ManualCodeTablePage.tsx"),
    read("components/FieldMappingPage.tsx"),
    read("components/sidebar/ManualCodeTableSidebar.tsx"),
    read("components/sidebar/MappingSidebar.tsx"),
    read("api/fieldMapping.ts"),
    read("api/manualCodeTables.ts"),
    read("hooks/useManualCodeTableModule.ts"),
  ]);

  assert.match(moduleContent, /catalogExportEnabled/);
  assert.match(codeTables, /canExport \? <(?:button|Button)/);
  assert.match(mappings, /canExport \? <(?:button|Button)/);
  assert.match(codeSidebar, /canExport\s*\?/);
  assert.match(mappingSidebar, /canExport\s*\?/);
  assert.match(mappingApi, /field-mappings\/export/);
  assert.match(codeTableApi, /manual-code-tables\/export/);
  assert.match(codeTableHook, /exportManualCodeTablesCsv/);
});

test("public push mock projection retains contacts but omits connection fields", async () => {
  const source = await read("api/push.ts");
  assert.doesNotMatch(source, /host: system\.host/);
  assert.doesNotMatch(source, /account: system\.account/);
  assert.match(source, /downstreamContact: system\.downstreamContact/);
  assert.match(source, /dataDeveloperContact: system\.dataDeveloperContact/);
  assert.match(source, /fields: clone\(job\.fields \|\| \[\]\)/);
});
