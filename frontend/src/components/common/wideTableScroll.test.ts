import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateScrollbarThumbMetrics,
  calculateWideTableLayout,
} from "./wideTableScroll.ts";

const source = readFileSync(new URL("./WideTableScroll.tsx", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("../system/MenuManagementPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/app.css", import.meta.url), "utf8");
const systemStyles = readFileSync(new URL("../../styles/system.css", import.meta.url), "utf8");

const layoutInput = {
  wrapperRect: { left: 280, right: 1280, top: 160, bottom: 1480 },
  mainRect: { left: 244, right: 1880, top: 58, bottom: 900 },
  headerBottom: 198,
  headerHeight: 42,
  tableBottom: 1480,
  contentWidth: 1520,
  viewportWidth: 1920,
  wrapperClientWidth: 1000,
  scrollbarHeight: 14,
};

test("wide table layout shows a fixed rail only for overflowing visible content", () => {
  assert.equal(calculateWideTableLayout({ ...layoutInput, contentWidth: 1000 }).showScrollbar, false);
  assert.equal(calculateWideTableLayout({
    ...layoutInput,
    wrapperRect: { ...layoutInput.wrapperRect, top: 920, bottom: 1500 },
  }).showScrollbar, false);
  assert.equal(calculateWideTableLayout(layoutInput).showScrollbar, true);
});

test("a native scrollbar at the table bottom prevents a duplicate fixed rail", () => {
  const result = calculateWideTableLayout({
    ...layoutInput,
    wrapperRect: { ...layoutInput.wrapperRect, bottom: 850 },
    tableBottom: 850,
  });
  assert.equal(result.showScrollbar, false);
});

test("wide scrollbar thumb tracks horizontal range and clamps at both ends", () => {
  assert.deepEqual(calculateScrollbarThumbMetrics(700, 350, 1400, 0), {
    width: 175,
    left: 0,
    maxScroll: 1050,
  });
  assert.deepEqual(calculateScrollbarThumbMetrics(700, 350, 1400, 1050), {
    width: 175,
    left: 525,
    maxScroll: 1050,
  });
});

test("reusable rail is accessible and independent of the field-mapping grouped header", () => {
  assert.match(source, /role="scrollbar"/);
  assert.match(source, /aria-controls=\{scrollRegionId\}/);
  assert.match(source, /onPointerDown=\{handleScrollbarPointerDown\}/);
  assert.match(source, /onKeyDown=\{handleScrollbarKeyDown\}/);
  assert.match(source, /createPortal\(/);
  assert.doesNotMatch(source, /fm-group-head|renderStickyHeader/);
});

test("table overflow is scoped to the reusable table viewport, not globally overridden", () => {
  assert.match(styles, /\.tbl-wrap\s*\{[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.wide-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(styles, /\.fm-sticky-horizontal-scrollbar,\s*\.wide-table-sticky-scrollbar\s*\{[^}]*position:\s*fixed/);
});

test("menu navigation position precedes actions and the action cell stays in the same row", () => {
  const navHeading = menuSource.indexOf('>{tx("导航位置")}</th>');
  const actionHeading = menuSource.indexOf('>{tx("操作")}</th>');
  assert.ok(navHeading >= 0 && actionHeading > navHeading);
  assert.match(menuSource, /className="mobile-card-actions menu-actions-cell"/);
  assert.match(systemStyles, /menu-management-table th\.menu-actions-head,[\s\S]*?menu-management-table td\.menu-actions-cell\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(systemStyles, /menu-management-table th\.menu-actions-head\s*\{[\s\S]*?z-index:\s*2/);
  assert.doesNotMatch(systemStyles, /menu-management-table tbody tr\s*\{[^}]*height:\s*62px/);
  assert.doesNotMatch(systemStyles, /\.param-dict-table (?:th|td)\.param-col-actions\s*\{[^}]*position:\s*sticky/);
});
