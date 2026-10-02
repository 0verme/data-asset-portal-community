import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateScrollbarThumbMetrics,
  calculateWideTableLayout,
  syncHorizontalScroll,
} from "./wideTableLayout.ts";

const pageSource = readFileSync(new URL("../FieldMappingPage.tsx", import.meta.url), "utf8");
const tableSource = readFileSync(new URL("./FieldMappingWideTable.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles/app.css", import.meta.url), "utf8");

const baseInput = {
  wrapperRect: { left: 280, right: 1180, top: 160, bottom: 1480 },
  mainRect: { left: 244, right: 1880, top: 58, bottom: 900 },
  headerBottom: 198,
  headerHeight: 42,
  tableBottom: 1480,
  contentWidth: 1590,
  viewportWidth: 1920,
  wrapperClientWidth: 900,
  scrollbarHeight: 14,
};

test("does not add a sticky scrollbar when the table fits or is outside the viewport", () => {
  const fits = calculateWideTableLayout({ ...baseInput, contentWidth: 900 });
  assert.equal(fits.showScrollbar, false);

  const outside = calculateWideTableLayout({
    ...baseInput,
    wrapperRect: { ...baseInput.wrapperRect, top: 920, bottom: 1600 },
  });
  assert.equal(outside.showScrollbar, false);
});

test("shows a clipped viewport scrollbar while the overflowing table continues below the viewport", () => {
  const layout = calculateWideTableLayout(baseInput);
  assert.equal(layout.showScrollbar, true);
  assert.equal(layout.left, 280);
  assert.equal(layout.width, 900);
  assert.equal(layout.scrollbarTop, baseInput.mainRect.bottom);
});

test("uses the table's native scrollbar when its bottom is visible to avoid a duplicate", () => {
  const layout = calculateWideTableLayout({
    ...baseInput,
    wrapperRect: { ...baseInput.wrapperRect, bottom: 850 },
    tableBottom: 850,
  });
  assert.equal(layout.showScrollbar, false);
});

test("keeps the sticky header inside the main scroll viewport only after the original header leaves", () => {
  const sticky = calculateWideTableLayout({
    ...baseInput,
    wrapperRect: { ...baseInput.wrapperRect, top: -220, bottom: 1100 },
    headerBottom: -176,
    tableBottom: 1100,
  });
  assert.equal(sticky.showStickyHeader, true);
  assert.equal(sticky.headerTop, baseInput.mainRect.top);

  const originalVisible = calculateWideTableLayout(baseInput);
  assert.equal(originalVisible.showStickyHeader, false);
});

test("recalculates its clipped width and horizontal position after a container resize", () => {
  const resized = calculateWideTableLayout({
    ...baseInput,
    wrapperRect: { left: 280, right: 780, top: 160, bottom: 1480 },
    wrapperClientWidth: 500,
  });
  assert.equal(resized.width, 500);
  assert.equal(resized.showScrollbar, true);
});

test("sizes the custom scrollbar thumb proportionally and clamps it at both ends", () => {
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
  assert.deepEqual(calculateScrollbarThumbMetrics(500, 900, 700, 50), {
    width: 500,
    left: 0,
    maxScroll: 0,
  });
  assert.deepEqual(calculateScrollbarThumbMetrics(100, 1, 10000, 9999), {
    width: 24,
    left: 76,
    maxScroll: 9999,
  });
});

test("synchronizes native horizontal scroll positions in either direction without redundant writes", () => {
  const table = { scrollLeft: 275 };
  const stickyBar = { scrollLeft: 0 };
  syncHorizontalScroll(table, stickyBar);
  assert.equal(stickyBar.scrollLeft, 275);

  stickyBar.scrollLeft = 640;
  syncHorizontalScroll(stickyBar, table);
  assert.equal(table.scrollLeft, 640);
});

test("observes container/table resize and keeps the field mapping scroll controls synchronized", () => {
  assert.match(tableSource, /new ResizeObserver\(scheduleMeasure\)/);
  assert.match(tableSource, /window\.addEventListener\("resize", scheduleMeasure\)/);
  assert.match(tableSource, /syncHorizontalScroll\(wrapper, stickyHeaderRef\.current/);
  assert.match(tableSource, /syncHorizontalScroll\(stickyHeader, wrapper\)/);
  assert.match(tableSource, /role="scrollbar"/);
  assert.match(tableSource, /aria-controls="field-mapping-results-table"/);
  assert.match(tableSource, /onPointerDown=\{handleScrollbarPointerDown\}/);
  assert.match(tableSource, /onKeyDown=\{handleScrollbarKeyDown\}/);
  assert.match(styles, /\.fm-scrollbar-thumb[\s\S]*?cursor: grab/);
  assert.match(styles, /\.main\.fm-has-wide-table-scrollbar\s*\{\s*margin-bottom: 14px;/);
});

test("freezes only the two source context columns and preserves long values behind ellipsis titles", () => {
  assert.match(pageSource, /key: "srcSystem", label: "源系统", width: 260/);
  assert.match(pageSource, /key: "srcTable", label: "源系统表", width: 240/);
  assert.match(pageSource, /<MappingCellText value=\{row\.targetTable\} className="mono" \/>/);
  assert.match(styles, /\.fm-table tbody td:nth-child\(-n\+2\)[\s\S]*?position: sticky/);
  assert.match(styles, /\.fm-cell-ellipsis[\s\S]*?text-overflow: ellipsis/);
});
