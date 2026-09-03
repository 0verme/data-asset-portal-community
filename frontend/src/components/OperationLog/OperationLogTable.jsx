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

import { Highlight } from "../ui.tsx";
import { RowActions, StatusBadge } from "../common/index.ts";
import { formatDateTime } from "../../utils/date.ts";

function formatCost(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function OperationLogTable({ logs, query, onView }) {
  return (
    <div className="tbl-wrap">
      <table className="dt mobile-card-table">
        <thead>
          <tr>
            <th style={{ width: 168 }}>操作时间</th>
            <th style={{ width: 110 }}>操作用户</th>
            <th style={{ width: 120 }}>所属部门</th>
            <th style={{ width: 96 }}>模块</th>
            <th style={{ width: 80 }}>操作类型</th>
            <th style={{ width: 180 }}>操作对象</th>
            <th>操作内容</th>
            <th style={{ width: 88 }}>结果</th>
            <th style={{ width: 124 }}>IP 地址</th>
            <th style={{ width: 88 }}>耗时</th>
            <th style={{ width: 96, textAlign: "right" }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td data-label="" className="mono">{formatDateTime(log.createdAt)}</td>
              <td data-label="操作用户"><Highlight text={log.userName || "-"} q={query} /></td>
              <td data-label="所属部门">{log.deptName || "-"}</td>
              <td data-label="模块"><Highlight text={log.moduleName || "-"} q={query} /></td>
              <td data-label="操作类型">{log.operationType || "-"}</td>
              <td data-label="操作对象" className="mono"><span className="system-line-clamp"><Highlight text={log.operationObject || "-"} q={query} /></span></td>
              <td data-label="操作内容"><span className="system-line-clamp"><Highlight text={log.operationDesc || "-"} q={query} /></span></td>
              <td data-label="结果"><StatusBadge on={log.resultStatus === "success"} label={log.resultStatus === "success" ? "成功" : "失败"} /></td>
              <td data-label="IP 地址" className="mono">{log.ipAddress || "-"}</td>
              <td data-label="耗时" className="mono">{formatCost(log.costTimeMs)}</td>
              <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }}>
                <RowActions
                  extraActions={[{ key: "view", label: "详情", icon: "eye", onClick: () => onView(log) }]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { formatCost };
