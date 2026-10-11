import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("asset read controls use DAP adapters and preserve pressed-button semantics", async () => {
  const [view, switcher, home] = await Promise.all([
    read("./AssetView.tsx"),
    read("./AssetViewModeSwitcher.tsx"),
    read("../HomePage.tsx"),
  ]);

  assert.match(view, /from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(view, /<AdapterLoadingState[\s\S]*?label="正在加载资产元数据"/);
  assert.match(view, /<AdapterErrorState[\s\S]*?onRetry=\{loadHomeData\}/);
  assert.match(view, /<AssetViewModeSwitcher value=\{layout as ViewMode\} onChange=\{setLayout\} \/>/);
  assert.match(view, /<Button[\s\S]*?disabled=\{page <= 1\}/);
  assert.match(view, /<Button[\s\S]*?disabled=\{page >= pageCount\}/);

  assert.match(switcher, /import \{ Button \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(switcher, /role="group" aria-label="视图切换"/);
  assert.match(switcher, /aria-pressed=\{value === mode\.value\}/);
  assert.match(switcher, /onClick=\{\(\) => onChange\(mode\.value\)\}/);
  assert.doesNotMatch(switcher, /@cloudflare\/kumo/);
  assert.match(home, /import \{ EmptyState \} from "\.\.\/ui\/index\.ts"/);
});

test("asset detail and editor compose controls only from DAP adapters", async () => {
  const [detail, editor, actions, view] = await Promise.all([
    read("../DetailPage.tsx"),
    read("../TableEditor.tsx"),
    read("./asset/AssetEditorActions.tsx"),
    read("./AssetView.tsx"),
  ]);

  assert.match(detail, /import \{ Badge, Button, Input, Tabs \} from "\.\.\/ui\/index\.ts"/);
  assert.match(detail, /<Tabs[\s\S]*?value=\{tab\}[\s\S]*?onValueChange=\{onTabChange\}/);
  assert.match(detail, /<Input[\s\S]*?aria-label="在当前表内筛选字段"/);
  assert.doesNotMatch(detail, /<(?:button|input|select|textarea)\b/);

  assert.match(editor, /import \{ Button, IconButton, Input, Select, Textarea \} from "\.\.\/ui\/index\.ts"/);
  assert.match(editor, /collisionAvoidance=\{\{ side: "flip", align: "shift" \}\}[\s\S]*?side="top"/);
  assert.match(editor, /<AssetEditorActionBar[\s\S]*?<AssetDeleteZone/);
  assert.doesNotMatch(editor, /<(?:button|input|select|textarea)\b/);

  assert.ok(actions.includes('import { Button } from "../../../ui/index.ts";'));
  assert.match(actions, /confirmDeleteAction\(\{/);
  assert.match(actions, /confirmKeyword: name/);
  assert.doesNotMatch(`${detail}\n${editor}\n${actions}`, /@cloudflare\/kumo/);
  assert.match(view, /<AdapterLoadingState[\s\S]*?title="加载表详情"/);
  assert.match(view, /<AdapterErrorState[\s\S]*?title="表详情加载失败"/);
});

test("asset filters use scoped adapters without changing shared module sidebars", async () => {
  const [assetSidebar, assetFilter, sharedFilter] = await Promise.all([
    read("../sidebar/AssetSidebar.tsx"),
    read("../sidebar/asset/AssetSidebarFilterGroup.tsx"),
    read("../sidebar/common/SidebarFilterGroup.tsx"),
  ]);

  assert.match(assetSidebar, /AssetSidebarFilterGroup/);
  assert.match(assetFilter, /import \{ Button, Tooltip \} from "\.\.\/\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(assetFilter, /aria-pressed=\{typeof item\.active === "boolean" \? item\.active : undefined\}/);
  assert.match(assetFilter, /disabled=\{item\.disabled\}/);
  assert.match(assetFilter, /<Tooltip trigger=\{button\} content=\{item\.tooltip\}/);
  assert.doesNotMatch(assetFilter, /@cloudflare\/kumo/);
  assert.match(sharedFilter, /<button/);
  assert.doesNotMatch(sharedFilter, /ui\/index\.ts/);
});
