import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const moduleContentPath = fileURLToPath(
  new URL("./ModuleContent.jsx", import.meta.url),
);

test("business modules are lazy-loaded while the portal remains in the app shell", async () => {
  const source = await readFile(moduleContentPath, "utf8");

  assert.match(
    source,
    /import \{ SearchPortalPage \} from "\.\.\/SearchPortalPage\.(jsx|tsx)"/,
  );
  assert.match(source, /React\.Suspense/);
  assert.doesNotMatch(source, /from "\.\.\/views\/index\.js"/);
  assert.match(source, /MODULE_RENDERERS/);
  assert.doesNotMatch(source, /enabledModuleCodes/);

  for (const modulePath of [
    "../views/AssetView.tsx",
    "../views/ApiAssetView.tsx",
    "../views/IndicatorView.tsx",
    "../views/PushView.tsx",
    "../views/ReportView.tsx",
    "../views/RootView.tsx",
    "../views/SystemView.tsx",
    "../views/UpstreamView.tsx",
    "../FieldMappingPage.tsx",
    "../LineagePage.tsx",
    "../ManualCodeTablePage.tsx",
  ]) {
    assert.match(
      source,
      new RegExp(`import\\("${modulePath.replaceAll(".", "\\.")}"\\)`),
    );
  }
});

test("module dispatch uses registry map instead of long switch chain", async () => {
  const source = await readFile(moduleContentPath, "utf8");
  assert.doesNotMatch(source, /else if \(module === "/);
  assert.match(source, /MODULE_RENDERERS\[module\]/);
});
