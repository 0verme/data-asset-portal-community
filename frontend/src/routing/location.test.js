import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const locationPath = fileURLToPath(new URL("./location.js", import.meta.url));
const defaultsPath = fileURLToPath(new URL("../config/defaults.js", import.meta.url));
const appPath = fileURLToPath(new URL("../App.jsx", import.meta.url));

test("upstream view defaults to card and only accepts card or list from the URL", async () => {
  const [location, defaults] = await Promise.all([
    readFile(locationPath, "utf8"),
    readFile(defaultsPath, "utf8"),
  ]);

  assert.match(defaults, /export const DEFAULT_UP_VIEW = "card"/);
  assert.match(location, /const upstreamView = \["card", "list"\]\.includes\(searchParams\.get\("view"\)\)/);
  assert.match(location, /upstreamView: DEFAULT_UP_VIEW/);
});

test("app restores and writes the upstream card view through the URL", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /setUpstreamViewFromUrl\(next\.upstreamView \|\| DEFAULT_UP_VIEW\)/);
  assert.match(app, /upstream\.upstreamView !== DEFAULT_UP_VIEW && upRoute\.page === "list"/);
  assert.match(app, /params\.set\("view", upstream\.upstreamView\)/);
});

test("lineage defaults to table view and persists detail view in the URL", async () => {
  const [location, app] = await Promise.all([
    readFile(locationPath, "utf8"),
    readFile(appPath, "utf8"),
  ]);

  assert.match(location, /lineageRoute: \{ rootId: null, direction: "both", depth: 2, view: "table" \}/);
  assert.match(location, /view: \["table", "detail"\]\.includes\(searchParams\.get\("view"\)\)/);
  assert.match(app, /lineageRoute\.view !== "table"/);
  assert.match(app, /params\.set\("view", lineageRoute\.view\)/);
});
