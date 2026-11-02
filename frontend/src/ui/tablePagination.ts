export const DEFAULT_TABLE_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100];

export interface TablePaginationModel {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  firstItem: number;
  lastItem: number;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function resolveTablePaginationModel(
  page: number,
  pageSize: number,
  total: number,
): TablePaginationModel {
  const safePageSize = positiveInteger(pageSize, 1);
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const requestedPage = positiveInteger(page, 1);
  const safePage = Math.min(requestedPage, pageCount);
  const firstItem = safeTotal === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const lastItem = safeTotal === 0 ? 0 : Math.min(safePage * safePageSize, safeTotal);

  return {
    page: safePage,
    pageSize: safePageSize,
    total: safeTotal,
    pageCount,
    firstItem,
    lastItem,
  };
}

export function resolveTablePageSizeOptions(
  options: readonly number[] = DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  currentPageSize = 20,
): number[] {
  const pageSize = positiveInteger(currentPageSize, 20);
  return [...new Set([...options, pageSize].filter((option) => Number.isSafeInteger(option) && option > 0))]
    .sort((left, right) => left - right);
}
