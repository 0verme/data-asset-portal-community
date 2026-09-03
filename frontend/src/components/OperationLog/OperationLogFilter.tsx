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

import type { ChangeEvent } from "react";

import {
  OPERATION_MODULES,
  OPERATION_RESULTS,
  OPERATION_TYPES,
} from "../../data/operationLogs.ts";
import type { OperationLogFilter as OperationLogFilterState } from "./operationLogQuery.ts";
import { Icon } from "../ui.tsx";

/**
 * 操作日志查询筛选组件。
 * 关键词搜索复用顶部全局搜索，这里负责模块 / 操作类型 / 操作结果 / 时间范围。
 */

// datetime-local 值 "YYYY-MM-DDTHH:MM" → "YYYY-MM-DD HH:MM:SS"
function toDateTime(value: string, endOfMinute: boolean): string {
  if (!value) return "";
  return `${value.replace("T", " ")}:${endOfMinute ? "59" : "00"}`;
}

// 存储值 "YYYY-MM-DD HH:MM:SS" → datetime-local "YYYY-MM-DDTHH:MM"
function toLocalInput(value: string): string {
  if (!value) return "";
  return value.slice(0, 16).replace(" ", "T");
}

export interface OperationLogFilterProps {
  filter: OperationLogFilterState;
  onChange: (filter: OperationLogFilterState) => void;
  onReset: () => void;
}

export function OperationLogFilter({
  filter,
  onChange,
  onReset,
}: OperationLogFilterProps) {
  const update = (patch: Partial<OperationLogFilterState>) =>
    onChange({ ...filter, ...patch });

  const hasFilter = Boolean(
    filter.module ||
      filter.operationType ||
      (filter.result && filter.result !== "all") ||
      filter.startTime ||
      filter.endTime,
  );

  const handleChange = (
    event: ChangeEvent<HTMLSelectElement | HTMLInputElement>,
  ) => event;

  return (
    <div className="oplog-filter">
      <div className="oplog-filter-field">
        <label>
          <Icon name="layers" size={13} />
          模块
        </label>
        <select
          className="inp"
          value={filter.module || ""}
          onChange={(event) =>
            update({ module: handleChange(event).target.value })
          }
        >
          <option value="">全部模块</option>
          {OPERATION_MODULES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="oplog-filter-field">
        <label>
          <Icon name="filter" size={13} />
          操作类型
        </label>
        <select
          className="inp"
          value={filter.operationType || ""}
          onChange={(event) =>
            update({ operationType: handleChange(event).target.value })
          }
        >
          <option value="">全部类型</option>
          {OPERATION_TYPES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="oplog-filter-field">
        <label>
          <Icon name="check" size={13} />
          操作结果
        </label>
        <select
          className="inp"
          value={filter.result || "all"}
          onChange={(event) =>
            update({ result: handleChange(event).target.value })
          }
        >
          <option value="all">全部</option>
          {OPERATION_RESULTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div className="oplog-filter-field">
        <label>
          <Icon name="clock" size={13} />
          开始时间
        </label>
        <input
          className="inp"
          type="datetime-local"
          value={toLocalInput(filter.startTime)}
          onChange={(event) =>
            update({ startTime: toDateTime(event.target.value, false) })
          }
        />
      </div>

      <div className="oplog-filter-field">
        <label>
          <Icon name="clock" size={13} />
          结束时间
        </label>
        <input
          className="inp"
          type="datetime-local"
          value={toLocalInput(filter.endTime)}
          onChange={(event) =>
            update({ endTime: toDateTime(event.target.value, true) })
          }
        />
      </div>

      {hasFilter ? (
        <button
          className="btn oplog-filter-reset"
          type="button"
          onClick={onReset}
        >
          <Icon name="refresh" size={14} />
          重置筛选
        </button>
      ) : null}
    </div>
  );
}
