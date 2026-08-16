import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const apiAssetViewPath = fileURLToPath(new URL("./ApiAssetView.jsx", import.meta.url));
const indicatorEditorPath = fileURLToPath(new URL("../IndicatorEditor.jsx", import.meta.url));
const apiClientPath = fileURLToPath(new URL("../../api/apiAssets.js", import.meta.url));

test("API asset editor reuses the binary status toggle for create and edit", async () => {
  const [apiAssetView, indicatorEditor] = await Promise.all([
    readFile(apiAssetViewPath, "utf8"),
    readFile(indicatorEditorPath, "utf8"),
  ]);

  assert.match(apiAssetView, /import \{[^}]*BinaryStatusToggle[^}]*\} from "\.\.\/common\/index\.js"/);
  assert.match(apiAssetView, /<BinaryStatusToggle mode="status" name="status" value=\{form\.status\} onChange=\{\(value\) => set\("status", value\)\} \/>/);
  assert.doesNotMatch(apiAssetView, /<select className="sel" value=\{form\.status\}/);
  assert.match(indicatorEditor, /<BinaryStatusToggle mode="status" value=\{form\.status\}/);
});

test("API asset create and edit keep enabled/disabled payload values", async () => {
  const [apiAssetView, apiClient] = await Promise.all([
    readFile(apiAssetViewPath, "utf8"),
    readFile(apiClientPath, "utf8"),
  ]);

  assert.match(apiAssetView, /status: "enabled"/);
  assert.match(apiAssetView, /const submit = \(\) => onSave\(\{ \.\.\.form,/);
  assert.match(apiClient, /body:payload/);
  assert.match(apiClient, /body:\{status\}/);
});
