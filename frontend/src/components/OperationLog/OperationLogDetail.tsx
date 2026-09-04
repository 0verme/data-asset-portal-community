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

import React, { type ReactNode } from "react";

import type { MockOperationLogItem } from "../../data/operationLogs.ts";
import { formatDateTime } from "../../utils/date.ts";
import { ActionErrorBanner, StatusBadge } from "../common/index.ts";
import { Icon } from "../ui.tsx";
import { formatCost } from "./OperationLogTable.tsx";

interface RowProps {
  label: string;
  children?: ReactNode;
  mono?: boolean | undefined;
  full?: boolean | undefined;
}

function Row({ label, children, mono = false, full = false }: RowProps) {
  return (
    <div className={`oplog-detail-row${full ? " full" : ""}`}>
      <div className="oplog-detail-label">{label}</div>
      <div className={`oplog-detail-value${mono ? " mono" : ""}`}>
        {children ?? "-"}
      </div>
    </div>
  );
}

export interface OperationLogDetailProps {
  open: boolean;
  log: MockOperationLogItem | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}

/**
 * 操作日志详情弹窗。复用系统管理模块的 modal 样式。
 */
export function OperationLogDetail({
  open,
  log,
  loading,
  error,
  onClose,
}: OperationLogDetailProps) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="confirm-mask system-modal-mask" onMouseDown={onClose}>
      <div
        className="system-modal-card"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="editor-head system-modal-head">
          <div>
            <div className="editor-title">
              <Icon name="eye" size={18} color="var(--accent)" />
              <h2>操作日志详情</h2>
            </div>
            {log ? <div className="editor-sub">日志编号 #{log.id}</div> : null}
          </div>
          <div className="editor-actions">
            <button className="btn" type="button" onClick={onClose}>
              <Icon name="close" size={14} />
              关闭
            </button>
          </div>
        </div>

        <div className="system-modal-body">
          {loading ? (
            <div className="state-card" role="status" aria-live="polite">
              <div className="state-spinner" aria-hidden="true"></div>
              <h4>加载日志详情</h4>
            </div>
          ) : error ? (
            <ActionErrorBanner title="日志详情加载失败" message={error} />
          ) : log ? (
            <div className="oplog-detail-grid">
              <Row label="操作时间" mono>
                {formatDateTime(log.createdAt)}
              </Row>
              <Row label="操作用户">{log.userName}</Row>
              <Row label="用户 ID" mono>
                {log.userId}
              </Row>
              <Row label="所属部门">{log.deptName}</Row>
              <Row label="模块名称">{log.moduleName}</Row>
              <Row label="操作类型">{log.operationType}</Row>
              <Row label="操作对象" mono full>
                {log.operationObject}
              </Row>
              <Row label="请求方式" mono>
                {log.requestMethod}
              </Row>
              <Row label="请求地址" mono full>
                {log.requestUrl}
              </Row>
              <Row label="请求参数" mono full>
                <pre className="oplog-detail-pre">
                  {log.requestParams || "-"}
                </pre>
              </Row>
              <Row label="操作结果">
                <StatusBadge
                  on={log.resultStatus === "success"}
                  label={log.resultStatus === "success" ? "成功" : "失败"}
                />
              </Row>
              <Row label="耗时" mono>
                {formatCost(log.costTimeMs)}
              </Row>
              <Row label="错误信息" full>
                {log.errorMessage ? (
                  <span className="oplog-detail-error">{log.errorMessage}</span>
                ) : (
                  "-"
                )}
              </Row>
              <Row label="IP 地址" mono>
                {log.ipAddress}
              </Row>
              <Row label="User-Agent" mono full>
                <pre className="oplog-detail-pre">{log.userAgent || "-"}</pre>
              </Row>
              <Row label="备注" full>
                {log.remark || "-"}
              </Row>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
