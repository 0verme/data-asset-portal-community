import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const view = read("./components/views/PushView.tsx");
const systemEditor = read("./components/push/SystemEditor.tsx");
const jobEditor = read("./components/push/JobEditor.tsx");
const jobList = read("./components/push/PushJobList.tsx");
const jobDetail = read("./components/push/PushJobDetail.tsx");

test("push views use the frozen DAP adapters", () => {
  assert.match(view, /import \{ Button \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(view, /<Button[\s\S]*?className="btn primary"[\s\S]*?variant="primary"/);
  assert.match(systemEditor, /import \{ Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((systemEditor.match(/<Input/g) ?? []).length, 9);
  assert.match(systemEditor, /<Input\s+type="time"\s+step=\{60\}/);
  assert.equal((systemEditor.match(/<Select<string>/g) ?? []).length, 4);
  assert.equal((systemEditor.match(/<Textarea/g) ?? []).length, 1);
  assert.match(systemEditor, /placeholder="请选择归属部门"/);
  assert.match(jobEditor, /import \{ Button, IconButton, Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((jobEditor.match(/<Input/g) ?? []).length, 11);
  assert.equal((jobEditor.match(/<Select<string>/g) ?? []).length, 5);
  assert.equal((jobEditor.match(/<IconButton/g) ?? []).length, 3);
  assert.match(jobEditor, /<Button className="add-field"/);
  assert.match(jobList, /<Button className="btn" variant="secondary"/);
  assert.match(jobList, /<Button className="btn primary" variant="primary"/);
  assert.match(jobDetail, /<Button className="btn primary" variant="primary"/);
});

test("push views keep only the documented crumb-link native buttons", () => {
  assert.equal((jobList.match(/<button/g) ?? []).length, 1);
  assert.equal((jobDetail.match(/<button/g) ?? []).length, 2);
  [view, systemEditor, jobEditor, jobList, jobDetail].forEach((source) => {
    assert.doesNotMatch(source, /from "@cloudflare\/kumo\//);
  });
});
