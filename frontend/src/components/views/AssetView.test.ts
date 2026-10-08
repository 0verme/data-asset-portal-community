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

test("asset filters use scoped adapters without changing shared module sidebars", async () => {
  const [assetSidebar, assetFilter, sharedFilter] = await Promise.all([
    read("../sidebar/AssetSidebar.tsx"),
    read("../sidebar/asset/AssetSidebarFilterGroup.tsx"),
    read("../sidebar/common/SidebarFilterGroup.tsx"),
  ]);

  assert.match(assetSidebar, /AssetSidebarFilterGroup/);
  assert.match(assetFilter, /import \{ Button \} from "\.\.\/\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(assetFilter, /aria-pressed=\{typeof item\.active === "boolean" \? item\.active : undefined\}/);
  assert.match(assetFilter, /disabled=\{item\.disabled\}/);
  assert.doesNotMatch(assetFilter, /@cloudflare\/kumo/);
  assert.match(sharedFilter, /<button/);
  assert.doesNotMatch(sharedFilter, /ui\/index\.ts/);
});
