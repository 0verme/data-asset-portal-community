import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const view = read("./components/views/ApiAssetView.tsx");

test("api asset view uses the frozen DAP adapters", () => {
  assert.match(view, /import \{ Button, Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((view.match(/<Input/g) ?? []).length, 5);
  assert.equal((view.match(/<Button/g) ?? []).length, 6);
  assert.equal((view.match(/<Select<string>/g) ?? []).length, 2);
  assert.equal((view.match(/<Textarea/g) ?? []).length, 2);
  assert.doesNotMatch(view, /from "@cloudflare\/kumo\//);
});

test("api asset view keeps the documented native system select", () => {
  assert.equal((view.match(/<select\s/g) ?? []).length, 1);
  assert.match(view, /System <select> intentionally remains native/);
});
