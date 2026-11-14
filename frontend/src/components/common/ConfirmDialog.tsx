import React, { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui.tsx";

export interface ConfirmDialogProps {
  open: boolean;
  title?: string | undefined;
  content?: ReactNode | undefined;
  desc?: ReactNode | undefined;
  details?: readonly string[] | undefined;
  confirmKeyword?: string | undefined;
  confirmKeywordLabel?: string | undefined;
  keywordPlaceholder?: string | undefined;
  confirmText?: string | undefined;
  cancelText?: string | undefined;
  busy?: boolean | undefined;
  danger?: boolean | undefined;
  maskClosable?: boolean | undefined;
  onConfirm?: (() => void | Promise<unknown>) | undefined;
  onCancel?: (() => void) | undefined;
}

export type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "busy">;

export function ConfirmDialog({
  open,
  title,
  content,
  desc,
  details = [],
  confirmKeyword = "",
  confirmKeywordLabel,
  keywordPlaceholder = "",
  confirmText,
  cancelText,
  busy = false,
  danger = false,
  maskClosable = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation("common");
  const titleText = title ?? t("confirmation.defaultTitle");
  const contentText = content ?? t("confirmation.defaultContent");
  const keywordLabelText = confirmKeywordLabel ?? t("confirmation.keywordLabel");
  const confirmLabel = confirmText ?? t("confirmation.confirm");
  const cancelLabel = cancelText ?? t("action.cancel");
  const [internalBusy, setInternalBusy] = React.useState(false);
  const [keywordValue, setKeywordValue] = React.useState("");
  const pending = busy || internalBusy;
  const body = desc != null ? desc : contentText;
  const normalizedKeyword = String(confirmKeyword || "").trim();
  const keywordMatched = !normalizedKeyword || keywordValue.trim() === normalizedKeyword;

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
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
        onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="confirm-head">
          <span className="confirm-icon" aria-hidden="true">
            <Icon name={danger ? "trash" : "key"} size={20} color={danger ? "var(--danger)" : "var(--accent)"} />
          </span>
          <div className="confirm-title">{titleText}</div>
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
            <label className="confirm-keyword-label">{keywordLabelText}</label>
            <input
              className="inp mono"
              type="text"
              value={keywordValue}
              placeholder={keywordPlaceholder || normalizedKeyword}
              onChange={(event) => setKeywordValue(event.target.value)}
              disabled={pending}
            />
            <div className="confirm-keyword-hint">{t("confirmation.keywordHint", { keyword: normalizedKeyword })}</div>
          </div>
        ) : null}
        <div className="confirm-actions">
          <button className="btn" type="button" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
          <button className={danger ? "btn ghost-danger" : "btn primary"} type="button" onClick={handleConfirm} disabled={pending || !keywordMatched}>
            {pending ? t("confirmation.processing") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ConfirmModal = ConfirmDialog;
