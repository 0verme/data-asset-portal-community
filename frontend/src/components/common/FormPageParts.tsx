import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui.tsx";
import { confirmAction } from "./confirmService.tsx";
import type { ConfirmOptions } from "./ConfirmDialog.tsx";

export interface BreadcrumbItem {
  label?: string;
  onClick?: (() => void) | undefined;
  [key: string]: unknown;
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
  const { t } = useTranslation("common");
  const hasHeading = Boolean(title || subtitle || status);
  const derivedBack: BackLink | null = back?.onClick
    ? back
    : (() => {
        const firstClickable = breadcrumbs.find((item) => item.onClick);
        if (!firstClickable?.onClick) return null;
        return {
          onClick: firstClickable.onClick,
          text: back?.text || t("forms.backToPrevious"),
        };
      })();

  return (
    <>
      {derivedBack?.onClick ? (
        <button type="button" className="page-back" onClick={derivedBack.onClick}>
          <Icon name="chevron" size={14} />
          {derivedBack.text || t("forms.backToPrevious")}
        </button>
      ) : null}

      {breadcrumbs.length ? (
        <nav className="crumb" aria-label={t("accessibility.breadcrumb")}>
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
  cancelText,
  saveText,
  savingText,
  saveDisabled = false,
  cancelDisabled = false,
  saving = false,
  isDirty = false,
  cancelConfirmOptions,
}: FormActionBarProps) {
  const { t } = useTranslation("common");
  const cancelLabel = cancelText ?? t("action.cancel");
  const saveLabel = saveText ?? t("action.save");
  const savingLabel = savingText ?? t("action.saving");
  const handleCancel = async () => {
    if (saving || !onCancel) return;
    if (isDirty) {
      const confirmed = await confirmAction({
        title: t("forms.discardTitle"),
        content: t("forms.discardMessage"),
        confirmText: t("forms.discardConfirm"),
        cancelText: t("forms.continueEditing"),
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
            <Icon name="close" size={14} />{cancelLabel}
          </button>
          <button className="btn primary" onClick={onSave} disabled={saving || saveDisabled}>
            <Icon name="save" size={14} />{saving ? savingLabel : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
