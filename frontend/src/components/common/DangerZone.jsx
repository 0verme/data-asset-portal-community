import { Icon } from "../ui.jsx";

export function DangerZone({
  title = "危险操作",
  description = "以下操作不可逆，请确认影响范围后再继续。",
  actions = [],
}) {
  const visibleActions = actions.filter(Boolean);
  if (!visibleActions.length) return null;

  return (
    <section className="danger-zone" aria-label={title}>
      <div className="danger-zone-head">
        <div className="danger-zone-title">
          <Icon name="shield" size={16} color="var(--danger)" />
          <h3>{title}</h3>
        </div>
        {description ? <div className="danger-zone-desc">{description}</div> : null}
      </div>
      <div className="danger-zone-actions">
        {visibleActions.map((action) => (
          <button
            key={action.key}
            className={action.danger ? "btn ghost-danger" : "btn"}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.hint || ""}
          >
            {action.icon ? <Icon name={action.icon} size={14} /> : null}
            {action.label}
          </button>
        ))}
      </div>
      {visibleActions.some((action) => action.hint) ? (
        <div className="danger-zone-hints">
          {visibleActions.map((action) => (
            action.hint ? <div key={`${action.key}-hint`} className="danger-zone-hint">{action.hint}</div> : null
          ))}
        </div>
      ) : null}
    </section>
  );
}
