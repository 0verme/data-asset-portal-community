import { useTranslation } from "react-i18next";

import { Button } from "../../../ui/index.ts";
import { confirmAction, confirmDeleteAction } from "../../common/index.ts";
import { Icon } from "../../ui.tsx";

export interface AssetEditorActionBarProps {
  note: string;
  onCancel: () => void;
  onSave: () => void | Promise<unknown>;
  saving: boolean;
  isDirty: boolean;
}

export function AssetEditorActionBar({ note, onCancel, onSave, saving, isDirty }: AssetEditorActionBarProps) {
  const { t } = useTranslation("warehouse");
  const handleCancel = async () => {
    if (saving) return;
    if (isDirty) {
      const confirmed = await confirmAction({
        title: t("editor.discardTitle"),
        content: t("editor.discardDescription"),
        confirmText: t("editor.discardAction"),
        cancelText: t("editor.continueEditing"),
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
          <Button className="btn" variant="secondary" type="button" onClick={() => void handleCancel()} disabled={saving}>
            <Icon name="close" size={14} />{t("editor.cancel")}
          </Button>
          <Button className="btn primary" variant="primary" type="button" onClick={() => void onSave()} disabled={saving}>
            <Icon name="save" size={14} />{saving ? t("editor.saving") : t("editor.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface AssetDeleteZoneProps {
  name: string;
  onDelete?: ((name: string) => void | Promise<unknown>) | undefined;
}

export function AssetDeleteZone({ name, onDelete }: AssetDeleteZoneProps) {
  const { t } = useTranslation("warehouse");
  const removeAsset = async () => {
    const confirmed = await confirmDeleteAction({
      name,
      typeLabel: t("editor.deleteTypeLabel"),
      impact: t("editor.deleteImpact"),
      consequences: [
        t("editor.deleteConsequenceBackend"),
        t("editor.deleteConsequenceResponse"),
      ],
      confirmKeyword: name,
      confirmKeywordLabel: t("editor.confirmDeleteKeyword"),
    });
    if (confirmed) await onDelete?.(name);
  };

  return (
    <section className="danger-zone" aria-label={t("editor.dangerZone")}>
      <div className="danger-zone-head">
        <div className="danger-zone-title">
          <Icon name="shield" size={16} color="var(--danger)" />
          <h3>{t("editor.dangerZone")}</h3>
        </div>
        <div className="danger-zone-desc">{t("editor.deleteDescription")}</div>
      </div>
      <div className="danger-zone-actions">
        <Button className="btn ghost-danger" variant="danger" type="button" onClick={() => void removeAsset()}>
          <Icon name="trash" size={14} />{t("editor.deleteTable")}
        </Button>
      </div>
    </section>
  );
}
