import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("application footer keeps the version and exposes the project GitHub link", async () => {
  const [app, styles, defaults, releaseMetadata] = await Promise.all([
    read("./App.tsx"),
    read("./styles/app.css"),
    read("./config/defaults.ts"),
    read("./config/releaseMetadata.ts"),
  ]);

  assert.match(app, /APP_RELEASE_METADATA\.version/);
  assert.match(app, /href=\{APP_RELEASE_METADATA\.releaseUrl\}/);
  assert.match(
    app,
    /<a\s+className="app-footer-link"\s+href=\{APP_RELEASE_METADATA\.repositoryUrl\}\s+target="_blank"\s+rel="noopener noreferrer"[\s\S]*?GitHub ↗/
  );
  assert.match(app, /<footer className="app-footer-shell" role="contentinfo">/);
  assert.match(app, /<span className="app-footer-separator" aria-hidden="true">·<\/span>/);
  assert.doesNotMatch(defaults, /APP_VERSION|V\d+\.\d+\.\d+/);
  assert.match(releaseMetadata, /Object\.freeze\(__DAP_RELEASE_METADATA__\)/);
  assert.match(styles, /\.app-footer-shell \{[\s\S]*?border-top: 1px solid var\(--line\);[\s\S]*?background: transparent;/);
  assert.match(
    styles,
    /\.app-footer \{[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: 0 8px;[\s\S]*?padding: 0;[\s\S]*?border: 0;[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?color: var\(--ink-2\);/
  );
  assert.match(styles, /\.app-footer-version,[\s\S]*?\.app-footer-link \{[\s\S]*?color: var\(--ink-2\);[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /\.app-footer-link \{ transition: none; \}/);
  assert.match(styles, /\.app-footer-link:hover \{[\s\S]*?color: var\(--ink\);/);
  assert.doesNotMatch(styles, /\.portal-home-footer/);
});
