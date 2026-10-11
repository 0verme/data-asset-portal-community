import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("application footer keeps the version and exposes the project GitHub link", async () => {
  const [app, styles] = await Promise.all([read("./App.tsx"), read("./styles/app.css")]);

  assert.match(app, /数据资产管理与血缘分析平台 \{APP_VERSION\}/);
  assert.match(
    app,
    /<a\s+className="app-footer-link"\s+href="https:\/\/github\.com\/0verme\/data-asset-portal-community"\s+target="_blank"\s+rel="noopener noreferrer"[\s\S]*?GitHub ↗/
  );
  assert.match(styles, /\.app-footer-shell \{[\s\S]*?border-top: 1px solid var\(--line\);[\s\S]*?background: transparent;/);
  assert.match(
    styles,
    /\.app-footer \{[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: 0 8px;[\s\S]*?padding: 0;[\s\S]*?border: 0;[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?color: var\(--ink-2\);/
  );
  assert.match(styles, /\.app-footer-link \{[\s\S]*?color: var\(--ink-2\);[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /\.app-footer-link:hover \{[\s\S]*?color: var\(--ink\);/);
});
