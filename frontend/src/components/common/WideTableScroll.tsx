import {
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  calculateScrollbarThumbMetrics,
  calculateWideTableLayout,
  type WideTableLayout,
} from "./wideTableScroll.ts";

const SCROLLBAR_HEIGHT = 14;
const SCROLLBAR_TRACK_INSET = 8;
const MIN_SCROLLBAR_THUMB_WIDTH = 24;
const MOBILE_BREAKPOINT = 768;

interface ScrollSnapshot {
  layout: WideTableLayout;
  contentWidth: number;
  viewportWidth: number;
  maxScroll: number;
  scrollLeft: number;
}

interface PointerDrag {
  pointerId: number;
  offset: number;
}

export interface WideTableScrollProps {
  children: ReactNode;
  ariaLabel: string;
  className?: string | undefined;
}

const EMPTY_LAYOUT: WideTableLayout = {
  showScrollbar: false,
  showStickyHeader: false,
  left: 0,
  width: 0,
  scrollbarTop: 0,
  headerTop: 0,
};

const EMPTY_SNAPSHOT: ScrollSnapshot = {
  layout: EMPTY_LAYOUT,
  contentWidth: 0,
  viewportWidth: 0,
  maxScroll: 0,
  scrollLeft: 0,
};

const mainScrollbarReservations = new WeakMap<HTMLElement, Set<symbol>>();

function reserveMainScrollbarSpace(main: HTMLElement, owner: symbol, reserve: boolean): void {
  let owners = mainScrollbarReservations.get(main);
  if (!owners) {
    owners = new Set();
    mainScrollbarReservations.set(main, owners);
  }

  if (reserve) owners.add(owner);
  else owners.delete(owner);

  if (!owners.size) mainScrollbarReservations.delete(main);
  main.classList.toggle("wide-table-has-horizontal-scrollbar", owners.size > 0);
}

function sameSnapshot(left: ScrollSnapshot, right: ScrollSnapshot): boolean {
  return left.layout.showScrollbar === right.layout.showScrollbar
    && left.layout.left === right.layout.left
    && left.layout.width === right.layout.width
    && left.layout.scrollbarTop === right.layout.scrollbarTop
    && left.contentWidth === right.contentWidth
    && left.viewportWidth === right.viewportWidth
    && left.maxScroll === right.maxScroll
    && left.scrollLeft === right.scrollLeft;
}

export function WideTableScroll({ children, ariaLabel, className = "" }: WideTableScrollProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const [snapshot, setSnapshot] = useState<ScrollSnapshot>(EMPTY_SNAPSHOT);
  const reactId = useId();
  const scrollRegionId = `wide-table-scroll-${reactId.replace(/:/g, "")}`;

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const main = wrapper?.closest<HTMLElement>(".main");
    if (!wrapper || !main) return undefined;

    const owner = Symbol("wide-table-scrollbar");
    let reservedScrollbarSpace = false;
    let animationFrame = 0;
    let observedTable: HTMLTableElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const measure = (): void => {
      const table = wrapper.querySelector<HTMLTableElement>("table");
      if (table !== observedTable) {
        if (observedTable) resizeObserver?.unobserve(observedTable);
        observedTable = table;
        if (observedTable) resizeObserver?.observe(observedTable);
      }
      if (!table) {
        reserveMainScrollbarSpace(main, owner, false);
        reservedScrollbarSpace = false;
        setSnapshot(EMPTY_SNAPSHOT);
        return;
      }

      const wrapperRect = wrapper.getBoundingClientRect();
      const mainBounds = main.getBoundingClientRect();
      const reserveScrollbarGap = window.innerWidth > MOBILE_BREAKPOINT;
      const mainRect = {
        left: mainBounds.left,
        right: mainBounds.right,
        top: mainBounds.top,
        bottom: mainBounds.bottom - (!reservedScrollbarSpace && reserveScrollbarGap ? SCROLLBAR_HEIGHT : 0),
      };
      const tableRect = table.getBoundingClientRect();
      const headerRect = table.tHead?.getBoundingClientRect();
      const contentWidth = Math.max(wrapper.scrollWidth, table.scrollWidth);
      const nextLayout = calculateWideTableLayout({
        wrapperRect,
        mainRect,
        headerBottom: headerRect?.bottom ?? wrapperRect.top,
        headerHeight: headerRect?.height ?? 0,
        tableBottom: tableRect.bottom,
        contentWidth,
        viewportWidth: window.innerWidth,
        wrapperClientWidth: wrapper.clientWidth,
        scrollbarHeight: SCROLLBAR_HEIGHT,
      });
      const showScrollbar = nextLayout.showScrollbar && reserveScrollbarGap;
      const next: ScrollSnapshot = {
        layout: { ...nextLayout, showScrollbar },
        contentWidth,
        viewportWidth: wrapper.clientWidth,
        maxScroll: Math.max(0, wrapper.scrollWidth - wrapper.clientWidth),
        scrollLeft: wrapper.scrollLeft,
      };
      const reserveSpace = showScrollbar && reserveScrollbarGap;
      if (reserveSpace !== reservedScrollbarSpace) {
        reservedScrollbarSpace = reserveSpace;
        reserveMainScrollbarSpace(main, owner, reserveSpace);
        scheduleMeasure();
        return;
      }
      setSnapshot((current) => (sameSnapshot(current, next) ? current : next));
    };

    const scheduleMeasure = (): void => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        measure();
      });
    };

    const syncFromTable = (): void => {
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

    resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(wrapper);
    resizeObserver?.observe(main);

    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(scheduleMeasure);
    mutationObserver?.observe(wrapper, { childList: true, characterData: true, subtree: true });

    measure();
    return () => {
      wrapper.removeEventListener("scroll", syncFromTable);
      main.removeEventListener("scroll", mainScroll);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      reserveMainScrollbarSpace(main, owner, false);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  const setScrollPosition = (scrollLeft: number): void => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    wrapper.scrollLeft = Math.min(snapshot.maxScroll, Math.max(0, scrollLeft));
    const currentScrollLeft = wrapper.scrollLeft;
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

  const { layout, contentWidth, viewportWidth, maxScroll, scrollLeft } = snapshot;
  const scrollbarStyle: CSSProperties = {
    left: layout.left,
    top: layout.scrollbarTop,
    width: layout.width,
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

  return (
    <>
      <div
        ref={wrapperRef}
        id={scrollRegionId}
        className={`wide-table-scroll${className ? ` ${className}` : ""}`}
        data-wide-table-scroll=""
        role="region"
        aria-label={ariaLabel}
      >
        {children}
      </div>
      {layout.showScrollbar && maxScroll > 0 && typeof document !== "undefined"
        ? createPortal(
            <div
              className="wide-table-sticky-scrollbar"
              style={scrollbarStyle}
              role="scrollbar"
              aria-label={`${ariaLabel}横向滚动`}
              aria-controls={scrollRegionId}
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
              <div ref={scrollbarTrackRef} className="wide-table-scrollbar-track" aria-hidden="true">
                <div ref={scrollbarThumbRef} className="wide-table-scrollbar-thumb" style={thumbStyle} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
