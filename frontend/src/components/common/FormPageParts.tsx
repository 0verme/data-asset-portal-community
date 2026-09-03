import { Fragment, type ReactNode } from "react";

import { Icon } from "../ui.tsx";
import { confirmAction } from "./confirmService.tsx";
import type { ConfirmOptions } from "./ConfirmDialog.tsx";

export interface BreadcrumbItem {
  label: string;
  onClick?: (() => void) | undefined;
}

export interface BackLink {
  onClick: () => void;
  text?: string | undefined;
}

export interface PageHeaderProps {
  breadcrumbs?: readonly BreadcrumbItem[] | undefined;
  icon?: string | undefined;
  title?: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  back?: BackLink | null | undefined;
}

export function PageHeader({
  breadcrumbs = [],
  icon,
  title,
  subtitle,
  status,
  back,
}: PageHeaderProps) {
  const hasHeading = Boolean(title || subtitle || status);
  const derivedBack: BackLink | null = back?.onClick
    ? back
    : (() => {
        const firstClickable = breadcrumbs.find((item) => item.onClick);
        if (!firstClickable?.onClick) return null;
        return {
          onClick: firstClickable.onClick,
          text: back?.text || "返回上一层",
        };
      })();

  return (
    <>
      {derivedBack?.onClick ? (
        <button type="button" className="page-back" onClick={derivedBack.onClick}>
          <Icon name="chevron" size={14} />
          {derivedBack.text || "返回上一层"}
        </button>
      ) : null}

      {breadcrumbs.length ? (
        <nav className="crumb" aria-label="面包屑">
          {breadcrumbs.map((item, index) => (
            <Fragment key={`${item.label}-${index}`}>
              {index ? <span className="sep"><Icon name="chevron" size={13} /></span> : null}
              {item.onClick ? (
                <button type="button" className="crumb-link" onClick={item.onClick}>
                  {item.label}
                </button>
              ) : (
                <span className={index === breadcrumbs.length - 1 ? "cur" : ""} aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
      ) : null}

      {hasHeading ? (
        <div className="editor-head">
          <div>
            <div className="editor-title">
              {icon ? <Icon name={icon} size={20} color="var(--ink-2)" /> : null}
              <h2>{title}</h2>
            </div>
            {subtitle ? <div className="editor-sub">{subtitle}</div> : null}
            {status ? <div className="editor-status">{status}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export interface FormActionBarProps {
  note?: ReactNode;
  onCancel?: (() => void) | undefined;
  onSave?: (() => void | Promise<unknown>) | undefined;
  cancelText?: string | undefined;
  saveText?: string | undefined;
  savingText?: string | undefined;
  saveDisabled?: boolean | undefined;
  cancelDisabled?: boolean | undefined;
  saving?: boolean | undefined;
  isDirty?: boolean | undefined;
  cancelConfirmOptions?: ConfirmOptions | undefined;
}

export function FormActionBar({
  note,
  onCancel,
  onSave,
  cancelText = "取消",
  saveText = "保存",
  savingText = "保存中...",
  saveDisabled = false,
  cancelDisabled = false,
  saving = false,
  isDirty = false,
  cancelConfirmOptions,
}: FormActionBarProps) {
  const handleCancel = async () => {
    if (saving || !onCancel) return;
    if (isDirty) {
      const confirmed = await confirmAction({
        title: "放弃未保存修改？",
        content: "当前表单存在未保存内容，确认放弃并返回吗？",
        confirmText: "放弃修改",
        cancelText: "继续编辑",
        ...cancelConfirmOptions,
      });
      if (!confirmed) return;
    }
    onCancel();
  };

  return (
    <div className="form-action-bar">
      <div className="fab-note">{note}</div>
      <div className="fab-main">
        <div className="fab-actions">
          <button className="btn" onClick={handleCancel} disabled={saving || cancelDisabled}>
            <Icon name="close" size={14} />{cancelText}
          </button>
          <button className="btn primary" onClick={onSave} disabled={saving || saveDisabled}>
            <Icon name="save" size={14} />{saving ? savingText : saveText}
          </button>
        </div>
      </div>
    </div>
  );
}
