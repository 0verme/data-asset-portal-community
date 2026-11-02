export interface OperationLogFilter {
  module: string;
  operationType: string;
  result: string;
  startTime: string;
  endTime: string;
}

export interface OperationLogQueryState {
  filter: OperationLogFilter;
  page: number;
}

export const DEFAULT_OPERATION_LOG_FILTER: OperationLogFilter = {
  module: "",
  operationType: "",
  result: "all",
  startTime: "",
  endTime: "",
};

export function createOperationLogQueryState(): OperationLogQueryState {
  return { filter: DEFAULT_OPERATION_LOG_FILTER, page: 1 };
}

export function withOperationLogFilter(
  current: OperationLogQueryState,
  filter: OperationLogFilter,
): OperationLogQueryState {
  return { ...current, filter, page: 1 };
}

export function resolveOperationLogRequestPage(
  page: number,
  query: string,
  previousQuery: string,
): number {
  return query === previousQuery ? page : 1;
}

export function resolveOperationLogPageSize(
  page: number,
  requestedPageSize: number,
  result: { items: readonly unknown[]; total: number; pageSize?: number | undefined },
): number {
  const actualPageSize = result.pageSize;
  if (typeof actualPageSize === "number" && Number.isSafeInteger(actualPageSize) && actualPageSize > 0) {
    return actualPageSize;
  }
  // The current operation-log endpoint omits pageSize metadata. On page one,
  // a short nonempty page with more matching rows proves the configured server
  // maximum is lower than the requested size.
  if (page === 1 && result.items.length > 0 && result.items.length < requestedPageSize && result.total > result.items.length) {
    return result.items.length;
  }
  return requestedPageSize;
}
