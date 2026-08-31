import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const commonSidebarPath = fileURLToPath(
	new URL("./sidebar/common/SidebarFilterGroup.jsx", import.meta.url),
);
const statusSidebarPath = fileURLToPath(
	new URL("./sidebar/common/StatusFilterGroup.jsx", import.meta.url),
);
const assetSidebarPath = fileURLToPath(
	new URL("./sidebar/AssetSidebar.jsx", import.meta.url),
);
const upstreamSidebarPath = fileURLToPath(
	new URL("./sidebar/UpstreamSidebar.jsx", import.meta.url),
);
const reportSidebarPath = fileURLToPath(
	new URL("./sidebar/ReportSidebar.jsx", import.meta.url),
);
const apiSidebarPath = fileURLToPath(
	new URL("./sidebar/ApiAssetSidebar.jsx", import.meta.url),
);
const pushSidebarPath = fileURLToPath(
	new URL("./sidebar/PushSidebar.jsx", import.meta.url),
);
const stylesPath = fileURLToPath(new URL("../styles/app.css", import.meta.url));

const readSources = async (...paths) =>
	(await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");

function assertAllOption(source, label) {
	assert.match(source, new RegExp(`allOption=\\{[\\s\\S]*?label: "${label}"`));
}

test("shared sidebar groups prepend an all option and expose accessible button semantics", async () => {
	const [common, status, styles] = await Promise.all([
		readFile(commonSidebarPath, "utf8"),
		readFile(statusSidebarPath, "utf8"),
		readFile(stylesPath, "utf8"),
	]);

	assert.match(
		common,
		/export function SidebarFilterGroup\(\{ title, items = \[\], allOption \}\)/,
	);
	assert.match(
		common,
		/const renderedItems = allOption \? \[allOption, \.\.\.items\] : items;/,
	);
	assert.match(common, /<button\s+type="button"/);
	assert.match(common, /disabled=\{item\.disabled\}/);
	assert.match(
		common,
		/aria-pressed=\{typeof item\.active === "boolean" \? item\.active : undefined\}/,
	);
	assert.match(status, /allOption=\{/);
	assert.match(styles, /\.side-item:focus-visible/);
});

test("all target asset sidebar dimensions have an explicit reset entry", async () => {
	const [asset, upstream, report, api, push] = await Promise.all([
		readFile(assetSidebarPath, "utf8"),
		readFile(upstreamSidebarPath, "utf8"),
		readFile(reportSidebarPath, "utf8"),
		readFile(apiSidebarPath, "utf8"),
		readFile(pushSidebarPath, "utf8"),
	]);

	assertAllOption(asset, "全部层级");
	assertAllOption(asset, "全部主题域");
	assertAllOption(upstream, "全部类型");
	assertAllOption(report, "全部报表类型");
	assertAllOption(report, "全部归属部门");
	assert.match(api, /group\(\s*"请求方式",\s*"method",\s*"全部请求方式"/);
	assert.match(
		api,
		/group\(\s*"业务系统",\s*"downstreamSystemId",\s*"全部业务系统"/,
	);
	assertAllOption(push, "全部协议");
	assertAllOption(push, "全部重要程度");
});

test("sidebar all entries clear only their own dimension while preserving peer filters", async () => {
	const [upstream, report, api, push] = await Promise.all([
		readFile(upstreamSidebarPath, "utf8"),
		readFile(reportSidebarPath, "utf8"),
		readFile(apiSidebarPath, "utf8"),
		readFile(pushSidebarPath, "utf8"),
	]);

	assert.match(
		upstream,
		/onClick: \(\) => setUpFilter\(\(prev\) => \(\{ \.\.\.prev, dbType: null \}\)\)/,
	);
	assert.match(
		report,
		/onClick: \(\) => setReportFilter\(\(prev\) => \(\{ \.\.\.prev, type: null \}\)\)/,
	);
	assert.match(
		report,
		/onClick: \(\) => setReportFilter\(\(prev\) => \(\{ \.\.\.prev, ownerDept: null \}\)\)/,
	);
	assert.match(
		api,
		/onClick: \(\) => setFilter\(\(previous\) => \(\{ \.\.\.previous, \[key\]: null \}\)\)/,
	);
	assert.match(
		push,
		/onClick: \(\) => setPushFilter\(\(prev\) => \(\{ \.\.\.prev, protocol: null \}\)\)/,
	);
	assert.match(
		push,
		/onClick: \(\) => setPushFilter\(\(prev\) => \(\{ \.\.\.prev, importanceLevel: null \}\)\)/,
	);

	assert.match(upstream, /active: !upFilter\.dbType/);
	assert.match(report, /active: !reportFilter\.type/);
	assert.match(
		api,
		/active: filter\[key\] === null \|\| filter\[key\] === undefined \|\| filter\[key\] === ""/,
	);
	assert.match(push, /active: !pushFilter\.protocol/);
	assert.match(push, /active: !pushFilter\.importanceLevel/);
});

test("all entries retain the existing facet count sources", async () => {
	const source = await readSources(
		assetSidebarPath,
		upstreamSidebarPath,
		reportSidebarPath,
		apiSidebarPath,
		pushSidebarPath,
	);

	assert.match(source, /count: Object\.values\(layerCounts\)\.reduce/);
	assert.match(source, /count: Object\.values\(domainCounts\)\.reduce/);
	assert.match(source, /count: upstreamSystems\.length/);
	assert.match(source, /count: reports\.length/);
	assert.match(source, /count: apiAsset\.items\.length/);
	assert.match(source, /count: pushSystems\.length/);
});
