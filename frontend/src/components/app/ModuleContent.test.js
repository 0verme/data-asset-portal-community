import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const moduleContentPath = fileURLToPath(new URL("./ModuleContent.jsx", import.meta.url));

test("business modules are lazy-loaded while the portal remains in the app shell", async () => {
  const source = await readFile(moduleContentPath, "utf8");

  assert.match(source, /import \{ SearchPortalPage \} from "\.\.\/SearchPortalPage\.jsx"/);
  assert.match(source, /React\.Suspense/);
  assert.doesNotMatch(source, /from "\.\.\/views\/index\.js"/);
  assert.match(source, /MODULE_RENDERERS/);
  assert.match(source, /ModuleDisabledPage/);
  assert.match(source, /enabledModuleCodes/);

  for (const modulePath of [
    "../views/AssetView.jsx",
    "../views/ApiAssetView.jsx",
    "../views/IndicatorView.jsx",
    "../views/PushView.jsx",
    "../views/ReportView.jsx",
    "../views/RootView.jsx",
    "../views/SystemView.jsx",
    "../views/UpstreamView.jsx",
    "../FieldMappingPage.jsx",
    "../LineagePage.jsx",
    "../ManualCodeTablePage.jsx",
  ]) {
    assert.match(source, new RegExp(`import\\("${modulePath.replaceAll(".", "\\.")}"\\)`));
  }
});

test("module dispatch uses registry map instead of long switch chain", async () => {
  const source = await readFile(moduleContentPath, "utf8");
  assert.doesNotMatch(source, /else if \(module === "/);
  assert.match(source, /MODULE_RENDERERS\[module\]/);
});
