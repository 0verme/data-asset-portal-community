import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const src = fileURLToPath(new URL("..", import.meta.url));
const read = (relativePath) => readFile(`${src}/${relativePath}`, "utf8");

test("remote auth bootstrap treats /auth/me 401 as anonymous public-catalog access", async () => {
  const [app, search, moduleContent] = await Promise.all([
    read("App.jsx"),
    read("components/SearchPortalPage.jsx"),
    read("components/app/ModuleContent.jsx"),
  ]);

  assert.match(app, /businessAccessReady = !isDbAuthMode\(\) \|\| authReady/);
  assert.match(app, /loadMenus\(\)/);
  assert.match(search, /publicAccessReady = true/);
  assert.doesNotMatch(search, /请先登录后搜索/);
  assert.doesNotMatch(moduleContent, /AuthenticatedBusinessPrompt/);
  assert.match(moduleContent, /publicAccessReady=\{context\.businessAccessReady\}/);
});

test("anonymous UI exposes catalog actions only and keeps write controls permission-gated", async () => {
  const sources = await Promise.all([
    read("components/views/AssetView.jsx"),
    read("components/IndicatorPage.jsx"),
    read("components/report/ReportList.jsx"),
    read("components/views/ApiAssetView.jsx"),
    read("components/views/UpstreamView.jsx"),
    read("components/views/PushView.jsx"),
    read("components/RootPages.jsx"),
  ]);

  for (const source of sources) assert.match(source, /canEdit/);
  assert.match(sources[0], /canEdit \? <button/);
  assert.match(sources[1], /canEdit \? <button/);
  assert.match(sources[2], /canEdit \? <button/);
  assert.match(sources[3], /canEdit \? <button/);
  assert.match(sources[4], /onNew=\{canEdit \?/);
  assert.match(sources[5], /canEdit \? <button/);
  assert.match(sources[6], /canEdit \? <button/);
});

test("public push mock projection does not retain connection or contact fields", async () => {
  const source = await read("api/push.ts");
  assert.doesNotMatch(source, /host: system\.host/);
  assert.doesNotMatch(source, /downstreamContact: system\.downstreamContact/);
  assert.doesNotMatch(source, /dataDeveloperContact: system\.dataDeveloperContact/);
});
