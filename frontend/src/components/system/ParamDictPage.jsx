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

import { Highlight, Icon } from "../ui.tsx";
import { EmptyState, RowActions, StatusBadge } from "../common/index.ts";
import { formatDateTime } from "../../utils/date.ts";
import { PARAM_STATUS_META } from "./constants.js";

export function ParamDictPage({
  categories,
  items,
  selectedCategoryCode,
  query,
  canEdit,
  onPickCategory,
  onNew,
  onEdit,
  onChangeStatus,
}) {
  const selectedCategory = categories.find((item) => item.code === selectedCategoryCode) || null;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (selectedCategoryCode && item.categoryCode !== selectedCategoryCode) return false;
    if (!normalizedQuery) return true;
    return [item.categoryCode, item.categoryName, item.code, item.name, item.value, item.desc]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">DICT</span>参数字典</div>
          <div className="page-sub">
            当前分类 <b>{selectedCategory?.name || "未选择"}</b>
            {selectedCategory ? <>，共 <b>{filteredItems.length}</b> 条字典项</> : null}
            {query ? <>，匹配 “{query}”</> : null}
          </div>
        </div>
        <div className="head-actions">
          <button className="btn primary" type="button" onClick={onNew}>
            <Icon name="plus" size={15} />新增参数
          </button>
        </div>
      </div>

      <div className="system-split">
        <div className="system-panel system-panel-nav">
          <div className="system-panel-head">
            <h3><Icon name="book" size={14} />参数分类</h3>
          </div>
          <div className="system-category-list">
            {categories.map((category) => (
              <button
                key={category.code}
                type="button"
                className={`system-category-item${selectedCategoryCode === category.code ? " active" : ""}`}
                onClick={() => onPickCategory(category.code)}
              >
                <div>
                  <div className="system-category-name">{category.name}</div>
                  <div className="system-category-code mono">{category.code}</div>
                </div>
                <span className="system-category-count">{category.count || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="system-panel system-panel-main">
          <div className="system-panel-head">
            <div>
              <h3>{selectedCategory?.name || "参数字典"}</h3>
              <div className="system-panel-sub">{selectedCategory?.desc || "请选择一个分类查看字典项。"}</div>
            </div>
          </div>

          {!selectedCategory ? (
            <EmptyState title="暂无参数分类" desc="当前没有可用分类。" />
          ) : !filteredItems.length ? (
            <EmptyState
              title="当前分类暂无字典项"
              desc="可以新增一条参数，或切换到其他分类。"
              actionText={canEdit ? "新增参数" : ""}
              onAction={canEdit ? onNew : undefined}
            />
          ) : (
            <div className="tbl-wrap system-inner-table param-dict-table-wrap">
              <table className="dt param-dict-table mobile-card-table">
                <thead>
                  <tr>
                    <th className="param-col-category">参数分类</th>
                    <th className="param-col-code">参数编码</th>
                    <th className="param-col-name">参数名称</th>
                    <th className="param-col-value">参数值</th>
                    <th className="param-col-status">状态</th>
                    <th className="param-col-updated">更新时间</th>
                    <th className="param-col-desc">说明</th>
                    <th className="param-col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={`${item.categoryCode}-${item.id}-${item.code}`}>
                      <td data-label=""><span className="system-line-clamp"><Highlight text={item.categoryName || item.categoryCode} q={query} /></span></td>
                      <td data-label="参数编码" className="mono"><span className="system-line-clamp"><Highlight text={item.code} q={query} /></span></td>
                      <td data-label="参数名称"><span className="system-line-clamp"><Highlight text={item.name} q={query} /></span></td>
                      <td data-label="参数值" className="mono"><span className="system-line-clamp"><Highlight text={item.value} q={query} /></span></td>
                      <td data-label="状态"><StatusBadge status={item.status} metaMap={PARAM_STATUS_META} /></td>
                      <td data-label="更新时间" className="mono param-updated-cell">{formatDateTime(item.updatedAt)}</td>
                      <td data-label="说明"><span className="system-line-clamp"><Highlight text={item.desc || "-"} q={query} /></span></td>
                      <td data-label="" className="param-col-actions mobile-card-actions">
                        <RowActions
                          onEdit={() => onEdit(item)}
                          toggle={{
                            enabled: item.status === "enabled",
                            label: item.name,
                            onToggle: () => onChangeStatus(item, item.status === "enabled" ? "disabled" : "enabled"),
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
