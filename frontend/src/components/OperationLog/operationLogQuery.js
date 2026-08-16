export const DEFAULT_OPERATION_LOG_FILTER = {
  module: "",
  operationType: "",
  result: "all",
  startTime: "",
  endTime: "",
};

export function createOperationLogQueryState() {
  return { filter: DEFAULT_OPERATION_LOG_FILTER, page: 1 };
}

export function withOperationLogFilter(current, filter) {
  return { ...current, filter, page: 1 };
}

export function resolveOperationLogRequestPage(page, query, previousQuery) {
  return query === previousQuery ? page : 1;
}
