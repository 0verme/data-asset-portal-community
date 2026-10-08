import { useState, type ReactNode } from "react";

import { Button } from "./Button.tsx";
import { Dialog } from "./overlays.tsx";
import "./overlays.css";

export interface FormModalProps {
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
  open,
  title,
  subtitle,
  icon,
  children,
  onClose,
  onSubmit,
  submitText = "保存修改",
  cancelText = "取消",
  busy = false,
  showSubmit = true,
  closeOnOutsideClick = true,
}: FormModalProps) {
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
          aria-label="关闭弹窗"
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
      className="dap-ui-form-modal"
    >
      <div className="dap-ui-form-modal-body">{children}</div>
      <div className="dap-ui-dialog-actions">
        <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
          {cancelText}
        </Button>
        {showSubmit ? (
          <Button variant="primary" type="button" onClick={handleSubmit} disabled={pending}>
            {pending ? "保存中..." : submitText}
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
