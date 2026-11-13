import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const apiAssetViewPath = fileURLToPath(
  new URL("./ApiAssetView.tsx", import.meta.url),
);
const indicatorEditorPath = fileURLToPath(
  new URL("../IndicatorEditor.tsx", import.meta.url),
);
const apiClientPath = fileURLToPath(
  new URL("../../api/apiAssets.ts", import.meta.url),
);
const assetReferenceSelectorPath = fileURLToPath(
  new URL("../common/AssetReferenceSelector.tsx", import.meta.url),
);

test("API asset editor reuses the binary status toggle for create and edit", async () => {
  const [apiAssetView, indicatorEditor] = await Promise.all([
    readFile(apiAssetViewPath, "utf8"),
    readFile(indicatorEditorPath, "utf8"),
  ]);

  assert.match(
    apiAssetView,
    /import \{[^}]*BinaryStatusToggle[^}]*\} from "\.\.\/common\/index\.ts"/,
  );
  assert.match(
    apiAssetView,
    /<BinaryStatusToggle\s+mode="status"\s+name="status"\s+value=\{form\.status\}/,
  );
  assert.match(
    apiAssetView,
    /onChange=\{\s*\(value\)\s*=>\s*set\(\s*"status",\s*typeof value === "boolean"/,
  );
  assert.doesNotMatch(
    apiAssetView,
    /<select className="sel" value=\{form\.status\}/,
  );
  assert.match(
    indicatorEditor,
    /<BinaryStatusToggle\s+mode="status"[\s\S]*?value=\{form\.status\}/,
  );
});

test("API asset create and edit keep enabled/disabled payload values", async () => {
  const [apiAssetView, apiClient] = await Promise.all([
    readFile(apiAssetViewPath, "utf8"),
    readFile(apiClientPath, "utf8"),
  ]);

  assert.match(apiAssetView, /status: "enabled"/);
  assert.match(apiAssetView, /validateApiAssetForm\(/);
  assert.match(apiAssetView, /focusApiAssetField\(validationErrors\)/);
  assert.match(apiAssetView, /data-api-asset-field=\{key\}/);
  assert.doesNotMatch(apiAssetView, /disabled=\{!form\.downstreamSystemId\}/);
  assert.match(apiClient, /body:\s*payload/);
  assert.match(apiClient, /body:\s*\{\s*status\s*\}/);
});

test("related asset pickers expose stable search accessible names", async () => {
  const assetReferenceSelector = await readFile(
    assetReferenceSelectorPath,
    "utf8",
  );

  assert.match(assetReferenceSelector, /aria-label=\{t\("references\.search", \{ title \}\)\}/);
  assert.match(assetReferenceSelector, /<Picker title=\{t\("references\.tables"\)\}/);
  assert.match(assetReferenceSelector, /<Picker title=\{t\("references\.indicators"\)\}/);
  assert.match(
    assetReferenceSelector,
    /const locked = disabled \|\| readonly;/,
  );
  assert.match(
    assetReferenceSelector,
    /<input value=\{search\} disabled=\{disabled\}/,
  );
});
