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
        title: t("actions.discardTitle"),
        content: t("actions.discardMessage"),
        confirmText: t("actions.discardConfirm"),
        cancelText: t("actions.continueEditing"),
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
            <Icon name="close" size={14} />{t("actions.cancel")}
          </Button>
          <Button className="btn primary" variant="primary" type="button" onClick={() => void onSave()} disabled={saving}>
            <Icon name="save" size={14} />{saving ? t("actions.saving") : t("actions.save")}
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
      title: t("actions.deleteConfirmTitle"),
      confirmText: t("actions.deleteConfirm"),
      cancelText: t("actions.cancel"),
      typeLabel: t("actions.assetTable"),
      impact: t("actions.deleteImpact"),
      consequences: [
        t("actions.deleteConsequenceValidation"),
        t("actions.deleteConsequenceBackendReason"),
      ],
      confirmKeyword: name,
      confirmKeywordLabel: t("actions.confirmTableName"),
    });
    if (confirmed) await onDelete?.(name);
  };

  return (
    <section className="danger-zone" aria-label={t("actions.dangerZone")}>
      <div className="danger-zone-head">
        <div className="danger-zone-title">
          <Icon name="shield" size={16} color="var(--danger)" />
          <h3>{t("actions.dangerZone")}</h3>
        </div>
        <div className="danger-zone-desc">{t("actions.deleteDescription")}</div>
      </div>
      <div className="danger-zone-actions">
        <Button className="btn ghost-danger" variant="danger" type="button" onClick={() => void removeAsset()}>
          <Icon name="trash" size={14} />{t("actions.deleteTable")}
        </Button>
      </div>
    </section>
  );
}
