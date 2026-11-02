import { useState } from "react";

import { TablePagination } from "./TablePagination.tsx";

function readIntegerParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : fallback;
}

export default function TablePaginationFixture() {
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(readIntegerParam(params, "page", 1));
  const [pageSize, setPageSize] = useState(readIntegerParam(params, "pageSize", 20));
  const total = readIntegerParam(params, "total", 2300);
  const loading = params.get("loading") === "true";
  const error = params.get("error") === "true";

  return (
    <main className="table-pagination-fixture">
      <h1>TablePagination adapter fixture</h1>
      {loading ? <p role="status">正在加载测试数据</p> : null}
      {error ? <p role="alert">分页数据加载失败</p> : null}
      <TablePagination
        ariaLabel="分页组件测试"
        page={page}
        pageSize={pageSize}
        total={total}
        loading={loading}
        disabled={error}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPage(1);
          setPageSize(nextPageSize);
        }}
      />
    </main>
  );
}
