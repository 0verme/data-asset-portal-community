import { Icon } from "../ui.jsx";
import { confirmAction } from "./confirmService.jsx";

export function RowActions({ onView, onEdit, extraActions = [], toggle, disabled = false }) {
  const runConfirm = async (options, action) => {
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
    runConfirm(
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
          onClick={() => runConfirm(action.confirm, action.onClick)}
        >
          {action.icon ? <Icon name={action.icon} size={14} /> : null}
          {action.label}
        </button>
      ))}
    </div>
  );
}
