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

import type { Key, ReactNode } from "react";

export interface GroupViewProps<T> {
  items: readonly T[];
  getKey: (item: T) => Key;
  onItemClick: (item: T) => void;
  groupBy: (item: T) => string;
  groupOrder?: readonly string[] | undefined;
  renderGroupLabel: (key: string) => ReactNode;
  renderGroupCount: (count: number) => ReactNode;
  renderCardName: (item: T) => ReactNode;
  renderCardBody: (item: T) => ReactNode;
}

/**
 * 通用分组视图（纯展示 + 配置驱动）。
 * 按 groupBy 分组、按 groupOrder 排序，分组标题、计数与卡片内容均由调用方提供。
 */
export function GroupView<T>({
  items,
  getKey,
  onItemClick,
  groupBy,
  groupOrder = [],
  renderGroupLabel,
  renderGroupCount,
  renderCardName,
  renderCardBody,
}: GroupViewProps<T>) {
  const groups: Record<string, T[]> = {};
  items.forEach((item) => {
    const key = groupBy(item);
    (groups[key] ||= []).push(item);
  });

  const keys = Object.keys(groups).sort(
    (a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b),
  );

  return (
    <div>
      {keys.map((key) => (
        <div className="group-sec" key={key}>
          <div className="group-head">
            <h3>{renderGroupLabel(key)}</h3>
            <span className="gcount">{renderGroupCount(groups[key]?.length || 0)}</span>
            <span className="gline"></span>
          </div>
          <div className="group-grid">
            {(groups[key] || []).map((item) => (
              <div className="gcard" key={getKey(item)} onClick={() => onItemClick(item)}>
                <div className="gc-name">{renderCardName(item)}</div>
                <div className="gc-cn">{renderCardBody(item)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
