import type { MouseEventHandler, ReactNode } from "react";

import { Icon } from "../ui.tsx";
import { confirmAction } from "./confirmService.tsx";
import type { ConfirmOptions } from "./ConfirmDialog.tsx";

export interface RowAction {
  key: string;
  label: ReactNode;
  icon?: string | undefined;
  danger?: boolean | undefined;
  confirm?: true | ConfirmOptions | undefined;
  onClick: () => void | Promise<unknown>;
}

export interface RowToggleAction {
  enabled: boolean;
  label?: string | undefined;
  onToggle: () => void | Promise<unknown>;
}

export interface RowActionsProps {
  onView?: MouseEventHandler<HTMLButtonElement> | undefined;
  onEdit?: MouseEventHandler<HTMLButtonElement> | undefined;
  extraActions?: readonly RowAction[] | undefined;
  toggle?: RowToggleAction | undefined;
  disabled?: boolean | undefined;
}

export function RowActions({
  onView,
  onEdit,
  extraActions = [],
  toggle,
  disabled = false,
}: RowActionsProps) {
  const runConfirm = async (
    options: true | ConfirmOptions | undefined,
    action: (() => void | Promise<unknown>) | undefined,
  ): Promise<void> => {
    if (!action) return;
    if (!options) {
      action();
      return;
    }
    const opts = options === true ? {} : options;
    if (await confirmAction(opts)) action();
  };

  const handleToggle = () => {
    if (!toggle) return;
    const acting = toggle.enabled ? "禁用" : "启用";
    void runConfirm(
      {
        title: acting,
        content: `确认${acting}${toggle.label ? ` ${toggle.label}` : ""}吗？`,
        confirmText: acting,
        cancelText: "取消",
      },
      toggle.onToggle,
    );
  };

  return (
    <div className="row-actions">
      {onView ? (
        <button className="btn" type="button" disabled={disabled} onClick={onView}>
          <Icon name="eye" size={14} />查看
        </button>
      ) : null}
      {onEdit ? (
        <button className="btn" type="button" disabled={disabled} onClick={onEdit}>
          <Icon name="edit" size={14} />编辑
        </button>
      ) : null}
      {toggle ? (
        <button
          className={"btn " + (toggle.enabled ? "status-action-disable" : "status-action-enable")}
          type="button"
          disabled={disabled}
          onClick={handleToggle}
        >
          <Icon name={toggle.enabled ? "close" : "check"} size={14} />
          {toggle.enabled ? "禁用" : "启用"}
        </button>
      ) : null}
      {extraActions.map((action) => (
        <button
          key={action.key}
          className={"btn" + (action.danger ? " ghost-danger" : "")}
          type="button"
          disabled={disabled}
          onClick={() => void runConfirm(action.confirm, action.onClick)}
        >
          {action.icon ? <Icon name={action.icon} size={14} /> : null}
          {action.label}
        </button>
      ))}
    </div>
  );
}
