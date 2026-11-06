export interface WideTableRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface WideTableLayoutInput {
  wrapperRect: WideTableRect;
  mainRect: WideTableRect;
  headerBottom: number;
  headerHeight: number;
  tableBottom: number;
  contentWidth: number;
  viewportWidth: number;
  wrapperClientWidth: number;
  scrollbarHeight: number;
}

export interface WideTableLayout {
  showScrollbar: boolean;
  showStickyHeader: boolean;
  left: number;
  width: number;
  scrollbarTop: number;
  headerTop: number;
}

export function calculateWideTableLayout(input: WideTableLayoutInput): WideTableLayout {
  const left = Math.max(input.wrapperRect.left, input.mainRect.left, 0);
  const right = Math.min(input.wrapperRect.right, input.mainRect.right, input.viewportWidth);
  const width = Math.max(0, right - left);
  const visibleTop = Math.max(input.wrapperRect.top, input.mainRect.top);
  const visibleBottom = Math.min(input.wrapperRect.bottom, input.mainRect.bottom);
  const tableIsVisible = width > 0 && visibleTop < visibleBottom;
  const hasHorizontalOverflow = input.contentWidth > input.wrapperClientWidth + 1;
  const nativeScrollbarIsVisible = input.wrapperRect.bottom > input.mainRect.top
    && input.wrapperRect.bottom <= input.mainRect.bottom;
  const mainHeight = input.mainRect.bottom - input.mainRect.top;
  const showScrollbar = tableIsVisible
    && hasHorizontalOverflow
    && !nativeScrollbarIsVisible
    && mainHeight >= input.scrollbarHeight;
  const scrollbarTop = input.mainRect.bottom;
  const showStickyHeader = tableIsVisible
    && input.headerBottom <= input.mainRect.top + 1
    && input.tableBottom > input.mainRect.top + input.headerHeight;

  return {
    showScrollbar,
    showStickyHeader,
    left,
    width,
    scrollbarTop,
    headerTop: input.mainRect.top,
  };
}

export interface ScrollbarThumbMetrics {
  width: number;
  left: number;
  maxScroll: number;
}

export function calculateScrollbarThumbMetrics(
  trackWidth: number,
  viewportWidth: number,
  contentWidth: number,
  scrollLeft: number,
  minimumThumbWidth = 24,
): ScrollbarThumbMetrics {
  const safeTrackWidth = Math.max(0, trackWidth);
  const safeViewportWidth = Math.max(0, viewportWidth);
  const safeContentWidth = Math.max(0, contentWidth);
  const maxScroll = Math.max(0, safeContentWidth - safeViewportWidth);
  const width = maxScroll === 0
    ? safeTrackWidth
    : Math.min(safeTrackWidth, Math.max(minimumThumbWidth, safeTrackWidth * safeViewportWidth / safeContentWidth));
  const maxThumbLeft = Math.max(0, safeTrackWidth - width);
  const left = maxScroll === 0
    ? 0
    : Math.min(maxThumbLeft, Math.max(0, scrollLeft / maxScroll * maxThumbLeft));

  return { width, left, maxScroll };
}

export interface HorizontalScrollPosition {
  scrollLeft: number;
}

export function syncHorizontalScroll(
  source: HorizontalScrollPosition,
  target: HorizontalScrollPosition,
): void {
  if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
}
