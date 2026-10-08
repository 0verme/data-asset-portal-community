import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const searchPagePath = fileURLToPath(new URL("./SearchPortalPage.tsx", import.meta.url));
const searchStylesPath = fileURLToPath(new URL("../styles/search.css", import.meta.url));

test("empty search results expose a clear action that preserves scope and focus", async () => {
  const [source, styles] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
  ]);

  assert.match(source, /groups\.length === 0 \?/);
  assert.match(source, /<EmptyState[\s\S]*?title="没有找到匹配的资产"/);
  assert.match(source, /className="sp-empty-action"/);
  assert.match(source, /aria-label="清空搜索"/);
  assert.match(source, /onClick=\{\(\) => clearSearch\(scope\)\}/);
  assert.match(source, /const clearSearch = \(nextScope = scope\) => \{/);
  assert.match(source, /resetSearchState\(nextScope\);/);
  assert.match(source, /setScope\(preservedScope\);/);
  assert.match(source, /searchParams\.delete\("q"\);/);
  assert.match(source, /searchParams\.set\("scope", nextScope\);/);
  assert.match(source, /syncSearchUrl\("", preservedScope\);/);
  assert.match(source, /inputRef\.current\?\.focus\(\);/);
  assert.match(styles, /\.sp-empty-action \{ margin: 16px auto 0; \}/);
});

test("Portal Search uses only DAP UI adapters for controls and feedback", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /from "\.\.\/ui\/index\.ts"/);
  assert.doesNotMatch(source, /@cloudflare\/kumo/);
  assert.match(source, /<Input[\s>]/);
  assert.match(source, /<Button[\s>]/);
  assert.match(source, /<LoadingState[\s>]/);
  assert.match(source, /<ErrorState[\s>]/);
  assert.match(source, /<EmptyState[\s>]/);
});

test("empty recovery remains separate from loading, error, and result branches", async () => {
  const source = await readFile(searchPagePath, "utf8");
  const loadingIndex = source.indexOf("searchLoading ?");
  const errorIndex = source.indexOf("searchError ?");
  const emptyIndex = source.indexOf("groups.length === 0 ?");
  const resultIndex = source.indexOf("sp-result-summary");

  assert.ok(loadingIndex >= 0, "loading state should remain explicit");
  assert.ok(errorIndex > loadingIndex, "error state should follow loading state");
  assert.ok(emptyIndex > errorIndex, "empty state should follow the error branch");
  assert.ok(resultIndex > emptyIndex, "successful results should remain after the empty branch");
});

test("truncated groups render 查看全部 from the formal hasMore flag", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /group\.hasMore === true \? \(/);
  assert.doesNotMatch(
    source,
    /group\.count > group\.items\.length \? \(/,
    "hasMore must not be inferred from count vs items",
  );
  assert.match(source, /className="sp-group-more"/);
  assert.match(source, /查看全部 \{group\.count\} 条/);
  assert.match(source, /已显示 \$\{group\.items\.length\} \/ \$\{group\.count\} 条/);
});

test("查看全部 navigates the group with the searched keyword", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /onClick=\{\(\) => handleNavigate\(group, searchedTerm\)\}/);
  assert.match(source, /onNavigate\?\.\(itemOrGroup, term\)/);
  assert.match(source, /aria-label=\{`查看全部\$\{group\.label\}结果`\}/);
});

test("portal scope parsing is the shared whitelist parser", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /readPortalSearchParams/);
  assert.match(source, /useRef\(readPortalSearchParams\(validScopeKeys\)\)/);
});

test("recommendations load independently, hide when empty or failed, and reuse search clicks", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /getHotKeywords\(\)/);
  assert.match(source, /\.catch\(\(\) => \{/);
  assert.match(source, /setHotKeywords\(\[\]\)/);
  assert.match(source, /hotTags\.length > 0 \?/);
  assert.match(source, /onClick=\{\(\) => pickHot\(item\.keyword\)\}/);
  assert.match(source, /runSearch\(term, scope\)/);
  assert.doesNotMatch(source, /PORTAL_HOT_TAGS|订单|商品|会员|门店|库存|销售额/);
});

test("long recommendation chips wrap within their available width", async () => {
  const styles = await readFile(searchStylesPath, "utf8");

  assert.match(styles, /\.sp-hot-item[\s\S]*?max-width: 100%/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /word-break: break-word/);
});
