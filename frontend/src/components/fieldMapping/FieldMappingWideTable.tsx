import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  calculateScrollbarThumbMetrics,
  calculateWideTableLayout,
  syncHorizontalScroll,
  type WideTableLayout,
} from "./wideTableLayout.ts";

const SCROLLBAR_HEIGHT = 14;
const SCROLLBAR_TRACK_INSET = 8;
const MIN_SCROLLBAR_THUMB_WIDTH = 24;

export interface HeaderMeasurement {
  contentWidth: number;
  columnWidths: readonly number[];
}

interface TableSnapshot {
  layout: WideTableLayout;
  contentWidth: number;
  viewportWidth: number;
  maxScroll: number;
  scrollLeft: number;
  columnWidths: readonly number[];
}

interface PointerDrag {
  pointerId: number;
  offset: number;
}

export interface FieldMappingWideTableProps {
  children: ReactNode;
  renderStickyHeader: (measurement: HeaderMeasurement) => ReactNode;
}

const EMPTY_LAYOUT: WideTableLayout = {
  showScrollbar: false,
  showStickyHeader: false,
  left: 0,
  width: 0,
  scrollbarTop: 0,
  headerTop: 0,
};

const EMPTY_SNAPSHOT: TableSnapshot = {
  layout: EMPTY_LAYOUT,
  contentWidth: 0,
  viewportWidth: 0,
  maxScroll: 0,
  scrollLeft: 0,
  columnWidths: [],
};

function sameSnapshot(left: TableSnapshot, right: TableSnapshot): boolean {
  return left.layout.showScrollbar === right.layout.showScrollbar
    && left.layout.showStickyHeader === right.layout.showStickyHeader
    && left.layout.left === right.layout.left
    && left.layout.width === right.layout.width
    && left.layout.scrollbarTop === right.layout.scrollbarTop
    && left.layout.headerTop === right.layout.headerTop
    && left.contentWidth === right.contentWidth
    && left.viewportWidth === right.viewportWidth
    && left.maxScroll === right.maxScroll
    && left.scrollLeft === right.scrollLeft
    && left.columnWidths.length === right.columnWidths.length
    && left.columnWidths.every((width, index) => width === right.columnWidths[index]);
}

function readColumnWidths(table: HTMLTableElement): number[] {
  const head = table.tHead;
  if (!head?.rows.length) return [];
  const leafRow = head.rows.item(head.rows.length - 1);
  if (!leafRow) return [];
  const widths = Array.from(leafRow.cells, (cell) => cell.getBoundingClientRect().width);

  if (table.classList.contains("is-field-view")) {
    const sourceColumnCount = Number(table.dataset["sourceColumnCount"] || 0);
    const arrowWidth = table.querySelector<HTMLElement>(".fm-arrow-col")?.getBoundingClientRect().width;
    if (sourceColumnCount > 0 && arrowWidth) widths.splice(sourceColumnCount, 0, arrowWidth);
  }

  return widths.map((width) => Math.max(1, Math.ceil(width * 100) / 100));
}

export function FieldMappingWideTable({ children, renderStickyHeader }: FieldMappingWideTableProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const [snapshot, setSnapshot] = useState<TableSnapshot>(EMPTY_SNAPSHOT);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const table = wrapper?.querySelector<HTMLTableElement>("table.fm-table");
    const main = wrapper?.closest<HTMLElement>(".main");
    if (!wrapper || !table || !main) return undefined;

    let animationFrame = 0;

    const measure = (): void => {
      const wrapperRect = wrapper.getBoundingClientRect();
      const mainBounds = main.getBoundingClientRect();
      const hasReservedScrollbarSpace = main.classList.contains("fm-has-wide-table-scrollbar");
      const reserveScrollbarGap = window.innerWidth > 768;
      // Reserve a flex gutter for the fixed rail so it never covers the visible table rows.
      const mainRect = {
        left: mainBounds.left,
        right: mainBounds.right,
        top: mainBounds.top,
        bottom: mainBounds.bottom - (!hasReservedScrollbarSpace && reserveScrollbarGap ? SCROLLBAR_HEIGHT : 0),
      };
      const tableRect = table.getBoundingClientRect();
      const headerRect = table.tHead?.getBoundingClientRect();
      const contentWidth = Math.max(wrapper.scrollWidth, table.scrollWidth);
      const columnWidths = readColumnWidths(table);
      const next: TableSnapshot = {
        layout: calculateWideTableLayout({
          wrapperRect,
          mainRect,
          headerBottom: headerRect?.bottom ?? wrapperRect.top,
          headerHeight: headerRect?.height ?? 0,
          tableBottom: tableRect.bottom,
          contentWidth,
          viewportWidth: window.innerWidth,
          wrapperClientWidth: wrapper.clientWidth,
          scrollbarHeight: SCROLLBAR_HEIGHT,
        }),
        contentWidth,
        viewportWidth: wrapper.clientWidth,
        maxScroll: Math.max(0, wrapper.scrollWidth - wrapper.clientWidth),
        scrollLeft: wrapper.scrollLeft,
        columnWidths,
      };
      const reserveScrollbarSpace = next.layout.showScrollbar && reserveScrollbarGap;
      if (reserveScrollbarSpace !== hasReservedScrollbarSpace) {
        main.classList.toggle("fm-has-wide-table-scrollbar", reserveScrollbarSpace);
        scheduleMeasure();
        return;
      }
      setSnapshot((current) => (sameSnapshot(current, next) ? current : next));
      syncHorizontalScroll(wrapper, stickyHeaderRef.current ?? wrapper);
    };

    const scheduleMeasure = (): void => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        measure();
      });
    };

    const syncFromTable = (): void => {
      syncHorizontalScroll(wrapper, stickyHeaderRef.current ?? wrapper);
      const scrollLeft = wrapper.scrollLeft;
      setSnapshot((current) => (
        current.scrollLeft === scrollLeft ? current : { ...current, scrollLeft }
      ));
      scheduleMeasure();
    };

    const mainScroll = (): void => scheduleMeasure();
    wrapper.addEventListener("scroll", syncFromTable, { passive: true });
    main.addEventListener("scroll", mainScroll, { passive: true });
    window.addEventListener("resize", scheduleMeasure);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(wrapper);
    resizeObserver?.observe(table);
    resizeObserver?.observe(main);

    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(scheduleMeasure);
    mutationObserver?.observe(table, { childList: true, characterData: true, subtree: true });

    measure();
    return () => {
      wrapper.removeEventListener("scroll", syncFromTable);
      main.removeEventListener("scroll", mainScroll);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      main.classList.remove("fm-has-wide-table-scrollbar");
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [children]);

  const setScrollPosition = (scrollLeft: number): void => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    wrapper.scrollLeft = Math.min(snapshot.maxScroll, Math.max(0, scrollLeft));
    const currentScrollLeft = wrapper.scrollLeft;
    syncHorizontalScroll(wrapper, stickyHeaderRef.current ?? wrapper);
    setSnapshot((current) => (
      current.scrollLeft === currentScrollLeft
        ? current
        : { ...current, scrollLeft: currentScrollLeft }
    ));
  };

  const scrollFromPointer = (event: ReactPointerEvent<HTMLDivElement>, offset: number): void => {
    const track = scrollbarTrackRef.current;
    if (!track || snapshot.maxScroll <= 0) return;
    const trackRect = track.getBoundingClientRect();
    const thumb = calculateScrollbarThumbMetrics(
      trackRect.width,
      snapshot.viewportWidth,
      snapshot.contentWidth,
      snapshot.scrollLeft,
      MIN_SCROLLBAR_THUMB_WIDTH,
    );
    const maxThumbLeft = Math.max(0, trackRect.width - thumb.width);
    const thumbLeft = Math.min(
      maxThumbLeft,
      Math.max(0, event.clientX - trackRect.left - offset),
    );
    const scrollLeft = maxThumbLeft === 0 ? 0 : thumbLeft / maxThumbLeft * snapshot.maxScroll;
    setScrollPosition(scrollLeft);
  };

  const handleScrollbarPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || snapshot.maxScroll <= 0) return;
    event.preventDefault();
    const thumb = scrollbarThumbRef.current;
    const isThumbTarget = thumb?.contains(event.target as Node) ?? false;
    const thumbRect = thumb?.getBoundingClientRect();
    const offset = isThumbTarget && thumbRect
      ? event.clientX - thumbRect.left
      : calculateScrollbarThumbMetrics(
        scrollbarTrackRef.current?.getBoundingClientRect().width ?? 0,
        snapshot.viewportWidth,
        snapshot.contentWidth,
        snapshot.scrollLeft,
        MIN_SCROLLBAR_THUMB_WIDTH,
      ).width / 2;
    pointerDragRef.current = { pointerId: event.pointerId, offset };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!isThumbTarget) scrollFromPointer(event, offset);
  };

  const handleScrollbarPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    scrollFromPointer(event, drag.offset);
  };

  const handleScrollbarPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerDragRef.current?.pointerId === event.pointerId) pointerDragRef.current = null;
  };

  const handleScrollbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const wrapper = wrapperRef.current;
    if (!wrapper || snapshot.maxScroll <= 0) return;
    const pageStep = Math.max(40, wrapper.clientWidth * 0.9);
    const lineStep = 40;
    let nextScrollLeft: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextScrollLeft = wrapper.scrollLeft - lineStep;
        break;
      case "ArrowRight":
        nextScrollLeft = wrapper.scrollLeft + lineStep;
        break;
      case "PageUp":
        nextScrollLeft = wrapper.scrollLeft - pageStep;
        break;
      case "PageDown":
        nextScrollLeft = wrapper.scrollLeft + pageStep;
        break;
      case "Home":
        nextScrollLeft = 0;
        break;
      case "End":
        nextScrollLeft = snapshot.maxScroll;
        break;
      default:
        return;
    }
    event.preventDefault();
    setScrollPosition(nextScrollLeft);
  };

  const syncFromStickyHeader = (): void => {
    const stickyHeader = stickyHeaderRef.current;
    const wrapper = wrapperRef.current;
    if (!stickyHeader || !wrapper) return;
    syncHorizontalScroll(stickyHeader, wrapper);
  };

  const { layout, contentWidth, viewportWidth, maxScroll, scrollLeft, columnWidths } = snapshot;
  const fixedScrollbarStyle: CSSProperties = {
    left: layout.left,
    top: layout.scrollbarTop,
    width: layout.width,
  };
  const fixedHeaderStyle: CSSProperties & { "--fm-sticky-first-column-width": string } = {
    left: layout.left,
    top: layout.headerTop,
    width: layout.width,
    "--fm-sticky-first-column-width": `${columnWidths[0] ?? 260}px`,
  };
  const wrapperStyle: CSSProperties & { "--fm-sticky-first-column-width": string } = {
    "--fm-sticky-first-column-width": `${columnWidths[0] ?? 260}px`,
  };
  const trackWidth = Math.max(0, layout.width - SCROLLBAR_TRACK_INSET * 2);
  const thumb = calculateScrollbarThumbMetrics(
    trackWidth,
    viewportWidth,
    contentWidth,
    scrollLeft,
    MIN_SCROLLBAR_THUMB_WIDTH,
  );
  const thumbStyle: CSSProperties = {
    width: thumb.width,
    transform: `translateX(${thumb.left}px)`,
  };

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    syncHorizontalScroll(wrapper, stickyHeaderRef.current ?? wrapper);
  }, [
    snapshot.layout.showStickyHeader,
    snapshot.contentWidth,
    snapshot.columnWidths,
    snapshot.scrollLeft,
  ]);

  return (
    <>
      <div ref={wrapperRef} className="fm-table-wrap" style={wrapperStyle}>
        {children}
      </div>
      {layout.showStickyHeader ? (
        <div
          ref={stickyHeaderRef}
          className="fm-sticky-table-head"
          style={fixedHeaderStyle}
          aria-hidden="true"
          onScroll={syncFromStickyHeader}
        >
          {renderStickyHeader({ contentWidth, columnWidths })}
        </div>
      ) : null}
      {layout.showScrollbar ? (
        <div
          ref={scrollbarRef}
          className="fm-sticky-horizontal-scrollbar"
          style={fixedScrollbarStyle}
          role="scrollbar"
          aria-label="字段映射表格横向滚动"
          aria-controls="field-mapping-results-table"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.round(maxScroll)}
          aria-valuenow={Math.round(scrollLeft)}
          aria-valuetext={`已滚动 ${Math.round(scrollLeft)}，可滚动 ${Math.round(maxScroll)} 像素`}
          tabIndex={0}
          onPointerDown={handleScrollbarPointerDown}
          onPointerMove={handleScrollbarPointerMove}
          onPointerUp={handleScrollbarPointerEnd}
          onPointerCancel={handleScrollbarPointerEnd}
          onLostPointerCapture={handleScrollbarPointerEnd}
          onKeyDown={handleScrollbarKeyDown}
        >
          <div ref={scrollbarTrackRef} className="fm-scrollbar-track" aria-hidden="true">
            <div ref={scrollbarThumbRef} className="fm-scrollbar-thumb" style={thumbStyle} />
          </div>
        </div>
      ) : null}
    </>
  );
}
