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

import { Icon } from "../ui.jsx";

/**
 * 通用卡片网格视图（纯展示 + 配置驱动）。
 * 不内置任何业务字段，所有内容由调用方通过 render-* props 提供。
 */
export function CardGridView({
  items,
  getKey,
  onItemClick,
  renderBadges,
  renderTitle,
  renderSubtitle,
  renderDesc,
  renderFootLeft,
  renderFootMeta,
  renderFootActions,
}) {
  return (
    <div className="card-grid">
      {items.map((item) => (
        <div key={getKey(item)} className="tcard" onClick={() => onItemClick(item)}>
          <div className="tcard-top">
            <div className="tcard-badges">{renderBadges(item)}</div>
            <Icon name="arrow" size={15} color="var(--ink-3)" />
          </div>
          <div>
            <div className="tcard-cn">{renderTitle(item)}</div>
            <div className="tcard-name" style={{ marginTop: 4 }}>{renderSubtitle(item)}</div>
          </div>
          <div className="tcard-desc">{renderDesc(item)}</div>
          <div className="tcard-foot">
            {renderFootLeft(item)}
            <div className="tcard-meta">{renderFootMeta(item)}</div>
            {renderFootActions ? <div onClick={(event) => event.stopPropagation()}>{renderFootActions(item)}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
