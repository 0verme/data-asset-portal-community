import React from "react";
import { Icon } from "../ui.jsx";

const DEFAULT_TITLE = "确认删除该数据？";
const DEFAULT_CONTENT = "删除后将无法恢复，请谨慎操作。";

export function ConfirmDialog({
  open,
  title = DEFAULT_TITLE,
  content = DEFAULT_CONTENT,
  desc,
  details = [],
  confirmKeyword = "",
  confirmKeywordLabel = "请输入确认信息",
  keywordPlaceholder = "",
  confirmText = "确认删除",
  cancelText = "取消",
  busy = false,
  danger = false,
  maskClosable = true,
  onConfirm,
  onCancel,
}) {
  const [internalBusy, setInternalBusy] = React.useState(false);
  const [keywordValue, setKeywordValue] = React.useState("");
  const pending = busy || internalBusy;
  const body = desc != null ? desc : content;
  const normalizedKeyword = String(confirmKeyword || "").trim();
  const keywordMatched = !normalizedKeyword || keywordValue.trim() === normalizedKeyword;

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape" && !pending) onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onCancel, open]);

  React.useEffect(() => {
    if (!open) {
      setInternalBusy(false);
      setKeywordValue("");
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (pending || !keywordMatched) return;
    try {
      const result = onConfirm?.();
      if (result && typeof result.then === "function") {
        setInternalBusy(true);
        await result;
      }
    } finally {
      setInternalBusy(false);
    }
  };

  return (
    <div className="confirm-mask" onMouseDown={() => maskClosable && !pending && onCancel?.()}>
      <div
        className={`confirm-card${danger ? " confirm-card-danger" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="confirm-head">
          <span className="confirm-icon" aria-hidden="true">
            <Icon name={danger ? "trash" : "key"} size={20} color={danger ? "var(--danger)" : "var(--accent)"} />
          </span>
          <div className="confirm-title">{title}</div>
        </div>
        {body ? <div className="confirm-desc">{body}</div> : null}
        {details.length ? (
          <div className="confirm-detail-list">
            {details.map((item) => (
              <div key={item} className="confirm-detail-item">{item}</div>
            ))}
          </div>
        ) : null}
        {normalizedKeyword ? (
          <div className="confirm-keyword">
            <label className="confirm-keyword-label">{confirmKeywordLabel}</label>
            <input
              className="inp mono"
              type="text"
              value={keywordValue}
              placeholder={keywordPlaceholder || normalizedKeyword}
              onChange={(event) => setKeywordValue(event.target.value)}
              disabled={pending}
            />
            <div className="confirm-keyword-hint">请输入 {normalizedKeyword} 以确认删除。</div>
          </div>
        ) : null}
        <div className="confirm-actions">
          <button className="btn" type="button" onClick={onCancel} disabled={pending}>
            {cancelText}
          </button>
          <button className={danger ? "btn ghost-danger" : "btn primary"} type="button" onClick={handleConfirm} disabled={pending || !keywordMatched}>
            {pending ? "处理中..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ConfirmModal = ConfirmDialog;
