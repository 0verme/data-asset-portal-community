/**
 * Pagination types matching backend ItemsResponse contract and UI pagination state.
 */

/**
 * Standard query parameters for paginated requests.
 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

/**
 * Paged response container matching backend FastAPI ItemsResponse / PageResult model.
 */
export interface PageResult<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

/**
 * UI-side pagination state with non-optional numbers for table rendering.
 */
export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Helper to create initial pagination state.
 */
export const DEFAULT_PAGE_SIZE = 10;

export function createInitialPagination(pageSize = DEFAULT_PAGE_SIZE): PaginationState {
  return {
    page: 1,
    pageSize,
    total: 0,
  };
}
