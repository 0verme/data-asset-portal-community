// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from "react";

import {
  getOperationLogDetail,
  getOperationLogList,
} from "../../api/operationLogs.ts";
import type { MockOperationLogItem } from "../../data/operationLogs.ts";
import { Icon } from "../ui.tsx";
import { Button, TablePagination } from "../../ui/index.ts";
import { OperationLogDetail } from "./OperationLogDetail.tsx";
import { OperationLogFilter } from "./OperationLogFilter.tsx";
import { OperationLogTable } from "./OperationLogTable.tsx";
import {
  createOperationLogQueryState,
  resolveOperationLogPageSize,
  resolveOperationLogRequestPage,
  withOperationLogFilter,
  type OperationLogQueryState,
} from "./operationLogQuery.ts";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100];

interface OperationLogDetailState {
  open: boolean;
  log: MockOperationLogItem | null;
  loading: boolean;
  error: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 操作日志页面容器：负责数据加载、筛选状态与详情弹窗。
 * 关键词来自顶部全局搜索（query）。
 */
export interface OperationLogPageProps {
  query: string;
}

export function OperationLogPage({ query }: OperationLogPageProps) {
  const tx = useUiCopy("admin");
  const [listQuery, setListQuery] = React.useState<OperationLogQueryState>(
    createOperationLogQueryState,
  );
  const { filter, page } = listQuery;
  const [logs, setLogs] = React.useState<MockOperationLogItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [detail, setDetail] = React.useState<OperationLogDetailState>({
    open: false,
    log: null,
    loading: false,
    error: "",
  });
  const requestSeq = React.useRef(0);
  const previousQueryRef = React.useRef(query);
  const requestPage = resolveOperationLogRequestPage(
    page,
    query,
    previousQueryRef.current,
  );

  const queryFilter = React.useMemo(
    () => ({
      ...filter,
      keyword: query,
      page: requestPage,
      pageSize,
    }),
    [filter, pageSize, query, requestPage],
  );

  const load = React.useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    try {
      const result = await getOperationLogList(queryFilter);
      if (seq !== requestSeq.current) return;
      const { items, total: nextTotal } = result;
      setLogs(items);
      setTotal(nextTotal);
      const effectivePageSize = resolveOperationLogPageSize(requestPage, pageSize, result);
      if (effectivePageSize !== pageSize) setPageSize(effectivePageSize);
      const lastPage = Math.max(1, Math.ceil(nextTotal / effectivePageSize));
      const normalizedPage = Math.min(result.page ?? requestPage, lastPage);
      if (normalizedPage !== requestPage) {
        setListQuery((current) => current.page === normalizedPage ? current : { ...current, page: normalizedPage });
      }
    } catch (nextError) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(nextError, "加载操作日志失败。"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [pageSize, queryFilter, requestPage]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 筛选或关键词变化时回到第一页
  React.useEffect(() => {
    previousQueryRef.current = query;
    setListQuery((current) =>
      current.page === 1 ? current : { ...current, page: 1 },
    );
  }, [query]);

  const openDetail = React.useCallback(async (log: MockOperationLogItem) => {
    setDetail({ open: true, log, loading: true, error: "" });
    try {
      const full = await getOperationLogDetail(log.id);
      setDetail({ open: true, log: full, loading: false, error: "" });
    } catch (nextError) {
      setDetail({
        open: true,
        log,
        loading: false,
        error: getErrorMessage(nextError, "加载日志详情失败。"),
      });
    }
  }, []);

  const closeDetail = React.useCallback(() => {
    setDetail({ open: false, log: null, loading: false, error: "" });
  }, []);


  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title">
            <span className="pt-code">LOG</span>{tx("操作日志")}</div>
          <div className="page-sub">
            {tx("共")}{" "}<b>{total}</b> {tx("条操作记录")}{query ? <>{tx("，匹配 “")}{query}”</> : null}
          </div>
        </div>
      </div>

      <OperationLogFilter
        filter={filter}
        onChange={(nextFilter) => {
          setListQuery((current) =>
            withOperationLogFilter(current, nextFilter),
          );
        }}
        onReset={() => {
          setListQuery(() => createOperationLogQueryState());
        }}
      />

      {loading ? (
        <div className="state-card" role="status" aria-live="polite">
          <div className="state-spinner" aria-hidden="true"></div>
          <h4>{tx("加载操作日志")}</h4>
          <p>{tx("正在准备审计日志记录。")}</p>
        </div>
      ) : error ? (
        <div className="state-card state-card-error" role="alert">
          <div className="ec">
            <Icon name="inbox" size={24} />
          </div>
          <h4>{tx("操作日志加载失败")}</h4>
          <p>{tx(error)}</p>
          <Button
            className="btn state-btn"
            variant="secondary"
            type="button"
            onClick={() => void load()}
          >
            {tx("重新加载")}</Button>
        </div>
      ) : !logs.length ? (
        <div className="empty">
          <div className="ec">
            <Icon name="inbox" size={26} />
          </div>
          <h4>{tx("未找到匹配的操作日志")}</h4>
          <p>{tx("可以调整筛选条件或时间范围后重试。")}</p>
        </div>
      ) : (
        <OperationLogTable logs={logs} query={query} onView={openDetail} />
      )}

      <TablePagination
        ariaLabel={tx("操作日志分页")}
        page={page}
        pageSize={pageSize}
        total={total}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        loading={loading}
        disabled={Boolean(error)}
        onPageChange={(nextPage) => {
          setListQuery((current) => ({ ...current, page: nextPage }));
        }}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setListQuery((current) => ({ ...current, page: 1 }));
        }}
      />

      <OperationLogDetail
        open={detail.open}
        log={detail.log}
        loading={detail.loading}
        error={detail.error}
        onClose={closeDetail}
      />
    </div>
  );
}
