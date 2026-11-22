import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";

import { Button } from "./Button.tsx";
import { Dialog } from "./overlays.tsx";
import "./overlays.css";

export interface FormModalProps {
  className?: string;
  bodyClassName?: string;
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  onClose?: (() => void) | undefined;
  onSubmit?: (() => void | Promise<unknown>) | undefined;
  submitText?: string | undefined;
  cancelText?: string | undefined;
  busy?: boolean | undefined;
  showSubmit?: boolean | undefined;
  closeOnOutsideClick?: boolean | undefined;
}

export function FormModal({
  className,
  bodyClassName,
  open,
  title,
  subtitle,
  icon,
  children,
  onClose,
  onSubmit,
  submitText,
  cancelText,
  busy = false,
  showSubmit = true,
  closeOnOutsideClick = true,
}: FormModalProps) {
  const { t } = useTranslation("common");
  const [internalBusy, setInternalBusy] = useState(false);
  const pending = busy || internalBusy;

  const handleSubmit = async () => {
    if (pending || !onSubmit) return;
    try {
      const result = onSubmit();
      if (result && typeof result.then === "function") {
        setInternalBusy(true);
        await result;
      }
    } catch {
      // Keep the modal open; the caller owns visible validation and error reporting.
    } finally {
      setInternalBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose?.();
      }}
      title={title}
      titleAdornment={icon}
      titleAction={(
        <Button
          variant="tertiary"
          type="button"
          aria-label={t("shared.closeDialog")}
          className="dap-ui-form-modal-close"
          onClick={() => !pending && onClose?.()}
          disabled={pending}
        >
          <span aria-hidden="true">×</span>
        </Button>
      )}
      description={subtitle}
      closeOnOutsideClick={closeOnOutsideClick}
      busy={pending}
      size="lg"
      className={["dap-ui-form-modal", className].filter(Boolean).join(" ")}
    >
      <div className={["dap-ui-form-modal-body", bodyClassName].filter(Boolean).join(" ")}>{children}</div>
      <div className="dap-ui-dialog-actions">
        <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
          {cancelText ?? t("action.cancel")}
        </Button>
        {showSubmit ? (
          <Button variant="primary" type="button" onClick={handleSubmit} disabled={pending}>
            {pending ? t("shared.saving") : submitText ?? t("shared.saveChanges")}
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
