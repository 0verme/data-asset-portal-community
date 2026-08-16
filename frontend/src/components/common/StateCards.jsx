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
import { getBinaryStatusValue, normalizeBinaryStatusLabel } from "./status.js";

export function LoadingState({ title, desc }) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <div className="state-spinner" aria-hidden="true"></div>
      <h4>{title}</h4>
      <p>{desc}</p>
    </div>
  );
}

export function ErrorState({ title, desc, onRetry }) {
  return (
    <div className="state-card state-card-error" role="alert">
      <div className="ec"><Icon name="inbox" size={24} /></div>
      <h4>{title}</h4>
      <p>{desc}</p>
      <button className="btn state-btn" onClick={onRetry}>重新加载</button>
    </div>
  );
}

export function EmptyState({ title, desc, actionText, onAction }) {
  return (
    <div className="empty">
      <div className="ec"><Icon name="inbox" size={26} /></div>
      <h4>{title}</h4>
      {desc ? <p>{desc}</p> : null}
      {actionText && onAction ? (
        <button className="btn primary system-empty-action" type="button" onClick={onAction}>
          <Icon name="plus" size={14} />{actionText}
        </button>
      ) : null}
    </div>
  );
}

const STATUS_TAG = {
  "st-on": { tag: "tag-ok", mark: "●" },
  "st-warn": { tag: "tag-warn", mark: "●" },
  "st-off": { tag: "tag-danger", mark: "○" },
};

// 默认状态映射：仅 enabled/disabled 两态（启用/禁用）。
const DEFAULT_STATUS_META = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

/**
 * 全站唯一的只读状态 pill。支持两种调用方式：
 *   1) status + 可选 metaMap：按映射取文案与色调（系统管理、指标等）。
 *      不传 metaMap 时回退到 enabled/disabled → 启用/禁用。
 *   2) on(布尔) + 可选 label：二态开关型，统一显示 启用/禁用。
 */
export function StatusBadge({ status, metaMap, on, label }) {
  let tone;
  let text;
  if (status !== undefined) {
    const sourceMeta = (metaMap || DEFAULT_STATUS_META)[status];
    const meta = sourceMeta || { label: label || status || "-", className: "st-off" };
    tone = STATUS_TAG[meta.className] || STATUS_TAG["st-off"];
    text = normalizeBinaryStatusLabel(status, meta.label);
  } else {
    const binaryStatus = getBinaryStatusValue(on);
    tone = binaryStatus === "enabled" ? STATUS_TAG["st-on"] : STATUS_TAG["st-off"];
    text = normalizeBinaryStatusLabel(binaryStatus, label);
  }
  return (
    <span className={`tag ${tone.tag}`}>
      {tone.mark}
      {text}
    </span>
  );
}
