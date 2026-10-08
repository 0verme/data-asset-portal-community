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
  const handleCancel = async () => {
    if (saving) return;
    if (isDirty) {
      const confirmed = await confirmAction({
        title: "放弃未保存修改？",
        content: "当前表单存在未保存内容，确认放弃并返回吗？",
        confirmText: "放弃修改",
        cancelText: "继续编辑",
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
            <Icon name="close" size={14} />取消
          </Button>
          <Button className="btn primary" variant="primary" type="button" onClick={() => void onSave()} disabled={saving}>
            <Icon name="save" size={14} />{saving ? "保存中..." : "保存"}
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
  const removeAsset = async () => {
    const confirmed = await confirmDeleteAction({
      name,
      typeLabel: "资产表",
      impact: "该表删除后，可能影响字段清单、DDL 展示、资产检索和历史追溯。请确认没有下游依赖。",
      consequences: [
        "删除前应以后端校验为准。",
        "若后端返回不可删除原因，页面会直接展示原因。",
      ],
      confirmKeyword: name,
      confirmKeywordLabel: "请输入表名二次确认",
    });
    if (confirmed) await onDelete?.(name);
  };

  return (
    <section className="danger-zone" aria-label="危险操作">
      <div className="danger-zone-head">
        <div className="danger-zone-title">
          <Icon name="shield" size={16} color="var(--danger)" />
          <h3>危险操作</h3>
        </div>
        <div className="danger-zone-desc">删除资产表会影响字段清单、DDL 展示和历史元数据追溯，请谨慎操作。</div>
      </div>
      <div className="danger-zone-actions">
        <Button className="btn ghost-danger" variant="danger" type="button" onClick={() => void removeAsset()}>
          <Icon name="trash" size={14} />删除表
        </Button>
      </div>
    </section>
  );
}
