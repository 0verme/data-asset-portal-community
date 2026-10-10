import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentSource = () => readFile(new URL("./AssetSidebarFilterGroup.tsx", import.meta.url), "utf8");
const sidebarSource = () => readFile(new URL("../AssetSidebar.tsx", import.meta.url), "utf8");

test("asset filter headings expose independent controlled disclosure semantics and DAP tooltips", async () => {
  const component = await componentSource();

  assert.match(component, /export interface AssetSidebarFilterItem extends SidebarFilterItem/);
  assert.match(component, /const \[expanded, setExpanded\] = useState\(true\)/);
  assert.match(component, /aria-expanded=\{expanded\}/);
  assert.match(component, /aria-controls=\{contentId\}/);
  assert.match(component, /hidden=\{!expanded\}/);
  assert.match(component, /role="group"[\s\S]*?aria-labelledby=\{headingId\}/);
  assert.match(component, /<Tooltip trigger=\{button\} content=\{item\.tooltip\}/);
  assert.doesNotMatch(component, /@cloudflare\/kumo/);
});

test("asset facet tooltips retain full layer labels and only expand long domain labels", async () => {
  const sidebar = await sidebarSource();

  assert.match(sidebar, /tooltip: layer \? `\$\{layer\.code\} \$\{layer\.cn\}` : undefined/);
  assert.match(sidebar, /tooltip: item\.key\.length > 6 \? item\.key : undefined/);
});

test("admins keep sidebar create access when the home list cannot show its primary action", async () => {
  const sidebar = await sidebarSource();

  assert.match(sidebar, /const showCreateInSidebar = canEdit && \(\s*route\.page !== "home" \|\| homeLoading \|\| Boolean\(homeError\)\s*\)/);
  assert.match(sidebar, /actions=\{\s*showCreateInSidebar\s*\?/);
});
