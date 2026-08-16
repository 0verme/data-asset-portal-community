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
import { Icon } from "../ui.jsx";
import { getOperationLogDetail, getOperationLogList } from "../../api/operationLogs.js";
import { OperationLogFilter } from "./OperationLogFilter.jsx";
import { OperationLogTable } from "./OperationLogTable.jsx";
import { OperationLogDetail } from "./OperationLogDetail.jsx";
import {
  createOperationLogQueryState,
  resolveOperationLogRequestPage,
  withOperationLogFilter,
} from "./operationLogQuery.js";

const PAGE_SIZE = 20;

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 操作日志页面容器：负责数据加载、筛选状态与详情弹窗。
 * 关键词来自顶部全局搜索（query）。
 */
export function OperationLogPage({ query }) {
  const [listQuery, setListQuery] = React.useState(createOperationLogQueryState);
  const { filter, page } = listQuery;
  const [logs, setLogs] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [detail, setDetail] = React.useState({ open: false, log: null, loading: false, error: "" });
  const requestSeq = React.useRef(0);
  const previousQueryRef = React.useRef(query);
  const requestPage = resolveOperationLogRequestPage(page, query, previousQueryRef.current);

  const queryFilter = React.useMemo(
    () => ({ ...filter, keyword: query, page: requestPage, pageSize: PAGE_SIZE }),
    [filter, query, requestPage],
  );

  const load = React.useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    try {
      const { items, total: nextTotal } = await getOperationLogList(queryFilter);
      if (seq !== requestSeq.current) return;
      setLogs(items);
      setTotal(nextTotal);
    } catch (nextError) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(nextError, "加载操作日志失败。"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [queryFilter]);

  React.useEffect(() => {
    load();
  }, [load]);

  // 筛选或关键词变化时回到第一页
  React.useEffect(() => {
    previousQueryRef.current = query;
    setListQuery((current) => (
      current.page === 1 ? current : { ...current, page: 1 }
    ));
  }, [query]);

  const openDetail = React.useCallback(async (log) => {
    setDetail({ open: true, log, loading: true, error: "" });
    try {
      const full = await getOperationLogDetail(log.id);
      setDetail({ open: true, log: full, loading: false, error: "" });
    } catch (nextError) {
      setDetail({ open: true, log, loading: false, error: getErrorMessage(nextError, "加载日志详情失败。") });
    }
  }, []);

  const closeDetail = React.useCallback(() => {
    setDetail({ open: false, log: null, loading: false, error: "" });
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">LOG</span>操作日志</div>
          <div className="page-sub">
            共 <b>{total}</b> 条操作记录
            {query ? <>，匹配 “{query}”</> : null}
          </div>
        </div>
      </div>

      <OperationLogFilter
        filter={filter}
        onChange={(nextFilter) => {
          setListQuery((current) => withOperationLogFilter(current, nextFilter));
        }}
        onReset={() => {
          setListQuery(() => createOperationLogQueryState());
        }}
      />

      {loading ? (
        <div className="state-card" role="status" aria-live="polite">
          <div className="state-spinner" aria-hidden="true"></div>
          <h4>加载操作日志</h4>
          <p>正在准备审计日志记录。</p>
        </div>
      ) : error ? (
        <div className="state-card state-card-error" role="alert">
          <div className="ec"><Icon name="inbox" size={24} /></div>
          <h4>操作日志加载失败</h4>
          <p>{error}</p>
          <button className="btn state-btn" type="button" onClick={load}>重新加载</button>
        </div>
      ) : !logs.length ? (
        <div className="empty">
          <div className="ec"><Icon name="inbox" size={26} /></div>
          <h4>未找到匹配的操作日志</h4>
          <p>可以调整筛选条件或时间范围后重试。</p>
        </div>
      ) : (
        <>
          <OperationLogTable logs={logs} query={query} onView={openDetail} />
          {totalPages > 1 ? (
            <div className="oplog-pager">
              <button
                className="btn"
                type="button"
                disabled={page <= 1}
                onClick={() => setListQuery((current) => ({
                  ...current,
                  page: Math.max(1, current.page - 1),
                }))}
              >
                <Icon name="chevron" size={14} />上一页
              </button>
              <span className="oplog-pager-info">第 {page} / {totalPages} 页</span>
              <button
                className="btn"
                type="button"
                disabled={page >= totalPages}
                onClick={() => setListQuery((current) => ({
                  ...current,
                  page: Math.min(totalPages, current.page + 1),
                }))}
              >
                下一页<Icon name="chevron" size={14} />
              </button>
            </div>
          ) : null}
        </>
      )}

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
