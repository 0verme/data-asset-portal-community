import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const moduleContentPath = fileURLToPath(
  new URL("./ModuleContent.tsx", import.meta.url),
);
const navigationControllerPath = fileURLToPath(
  new URL("../../hooks/useNavigationController.ts", import.meta.url),
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

test("asset search results keep stable table IDs and open typed citations on their detail routes", async () => {
  const [source, navigation] = await Promise.all([
    readFile(moduleContentPath, "utf8"),
    readFile(navigationControllerPath, "utf8"),
  ]);

  assert.match(source, /if \("assetId" in target && target\.assetId != null\)/);
  assert.match(source, /navigationTarget\.assetId = assetId;/);
  assert.match(source, /navigationTarget\.assetName = target\.ref;/);
  assert.match(source, /navigationTarget\.reportRoute = \{ page: "view", code: target\.ref \}/);
  assert.match(source, /navigationTarget\.indicatorRoute = \{ page: "view", id: target\.ref \}/);
  assert.match(source, /navigationTarget\.apiAssetRoute = \{ page: "view", code: target\.ref \}/);
  assert.match(navigation, /next\.indicatorRoute = pushTarget\?\.indicatorRoute \|\| DEFAULT_INDICATOR_ROUTE/);
  assert.match(navigation, /next\.reportRoute = pushTarget\?\.reportRoute \|\| DEFAULT_REPORT_ROUTE/);
  assert.match(navigation, /next\.apiAssetRoute = pushTarget\?\.apiAssetRoute \|\| DEFAULT_API_ASSET_ROUTE/);
});
