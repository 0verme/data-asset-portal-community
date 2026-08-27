import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("application footer keeps the version and exposes the project GitHub link", async () => {
  const [app, styles] = await Promise.all([read("./App.jsx"), read("./styles/app.css")]);

  assert.match(app, /数据资产管理与血缘分析平台 \{APP_VERSION\}/);
  assert.match(
    app,
    /<a\s+className="app-footer-link"\s+href="https:\/\/github\.com\/0verme\/data-asset-portal-community"\s+target="_blank"\s+rel="noopener noreferrer"[\s\S]*?GitHub ↗/
  );
  assert.match(styles, /\.app-footer \{[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: 0 8px;/);
  assert.match(styles, /\.app-footer-link \{[\s\S]*?color: var\(--ink-3\);[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /\.app-footer-link:hover \{[\s\S]*?color: var\(--ink-2\);/);
});
