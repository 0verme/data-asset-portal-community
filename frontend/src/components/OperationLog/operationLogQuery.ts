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
