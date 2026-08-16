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

export function FormModal({ open, title, subtitle, icon = "edit", children, onClose, onSubmit, submitText = "保存修改", cancelText = "取消", busy = false, showSubmit = true }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  return (
    <div className="confirm-mask system-modal-mask" onMouseDown={() => !busy && onClose?.()}>
      <div className="system-modal-card" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="system-modal-title">
        <div className="editor-head system-modal-head">
          <div className="system-modal-heading">
            <div className="editor-title">
              <span className="system-modal-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
              <h2 id="system-modal-title">{title}</h2>
            </div>
            {subtitle ? <div className="editor-sub">{subtitle}</div> : null}
          </div>
          <button className="system-modal-close" type="button" onClick={onClose} disabled={busy} aria-label="关闭弹窗">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="system-modal-body">{children}</div>
        <div className="system-modal-footer">
          <button className="btn" type="button" onClick={onClose} disabled={busy}>{cancelText}</button>
          {showSubmit ? (
            <button className="btn primary" type="button" onClick={onSubmit} disabled={busy}>
              <Icon name="save" size={14} />{busy ? "保存中..." : submitText}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
