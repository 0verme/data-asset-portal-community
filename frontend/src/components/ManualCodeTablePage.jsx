import { Highlight, Icon } from "./ui.jsx";
import {
  ActionErrorBanner,
  DangerZone,
  EmptyState,
  ErrorState,
  FormModal,
  FormSection,
  LoadingState,
  RowActions,
  StatusBadge,
  confirmDeleteAction,
} from "./common/index.js";
import {
  MANUAL_CODE_TABLE_STATUS_META,
  MANUAL_CODE_TABLE_STYLES,
} from "../hooks/useManualCodeTableModule.ts";
import { formatDateTime } from "../utils/date.ts";

const STYLE_LABELS = Object.fromEntries(MANUAL_CODE_TABLE_STYLES.map((item) => [item.value, item.label]));

function CodeTableForm({ module }) {
  const { form, setForm, formErrors, formModal } = module;
  const hasError = (field) => formErrors.some((item) => item.field === field);
  return (
    <>
      <ActionErrorBanner title="请先修正以下问题" messages={formErrors.map((item) => item.message)} />
      <FormSection title="码表信息">
        <div className="form-grid">
          <div className="fl">
            <label>表编码</label>
            <input className={`inp mono${hasError("tableCode") ? " invalid" : ""}`} value={form.tableCode} onChange={(event) => setForm((current) => ({ ...current, tableCode: event.target.value.toUpperCase() }))} placeholder="例如：DIM_GENDER" maxLength={64} />
          </div>
          <div className="fl">
            <label>表名称</label>
            <input className={`inp${hasError("tableName") ? " invalid" : ""}`} value={form.tableName} onChange={(event) => setForm((current) => ({ ...current, tableName: event.target.value }))} placeholder="例如：性别字典" maxLength={128} />
          </div>
          <div className="fl">
            <label>表样式</label>
            <select className={`inp${hasError("style") ? " invalid" : ""}`} value={form.style} onChange={(event) => setForm((current) => ({ ...current, style: event.target.value }))}>
              <option value="">请选择表样式</option>
              {MANUAL_CODE_TABLE_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="fl">
            <label>负责人</label>
            <input className="inp" value={form.owner} onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))} placeholder="例如：张敏" maxLength={64} />
          </div>
          <div className="fl full">
            <label>状态</label>
            <select className="inp" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="enabled">启用</option><option value="disabled">禁用</option>
            </select>
          </div>
          <div className="fl full">
            <label>说明</label>
            <textarea className="ta" value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} placeholder="补充用途、引用场景或值结构约定" maxLength={1000} />
          </div>
        </div>
      </FormSection>
      {formModal.mode === "edit" && formModal.initial ? (
        <DangerZone
          description="删除后码表将从湖仓登记清单移除；若只是暂时下线，建议优先禁用。"
          actions={[{
            key: "delete-code-table", label: "删除码值表", icon: "trash", danger: true,
            onClick: async () => {
              if (await confirmDeleteAction({
                name: formModal.initial.tableName,
                typeLabel: "手工码值表",
                impact: "删除后该码表的表级登记信息将不可恢复。",
                confirmKeyword: formModal.initial.tableCode,
                confirmKeywordLabel: "请输入表编码二次确认",
              })) module.remove(formModal.initial);
            },
          }]}
        />
      ) : null}
    </>
  );
}

function DetailModal({ item, onClose, onEdit, canEdit }) {
  if (!item) return null;
  return (
    <FormModal open title="码值表详情" subtitle={item.tableCode} icon="table" onClose={onClose} onSubmit={() => onEdit(item)} submitText="编辑" cancelText="关闭" busy={false} showSubmit={canEdit}>
      <div className="indicator-detail-grid">
        <div className="indicator-detail-item"><div className="indicator-detail-label">表编码</div><div className="indicator-detail-value mono">{item.tableCode}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">表名称</div><div className="indicator-detail-value">{item.tableName}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">表样式</div><div className="indicator-detail-value"><span className="tag tag-neutral">{STYLE_LABELS[item.style] || item.style}</span></div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">状态</div><div className="indicator-detail-value"><StatusBadge status={item.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">负责人</div><div className="indicator-detail-value">{item.owner || "-"}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">更新时间</div><div className="indicator-detail-value mono">{formatDateTime(item.updatedAt)}</div></div>
        <div className="indicator-detail-item full"><div className="indicator-detail-label">说明</div><div className="indicator-detail-value">{item.remark || "-"}</div></div>
      </div>
      {!canEdit ? <div className="page-sub">当前为只读访问，管理员登录后可编辑。</div> : null}
    </FormModal>
  );
}

export function ManualCodeTablePage({ module, query, canEdit }) {
  if (module.loading) return <LoadingState title="加载码值表维护模块" desc="正在读取湖仓手工码值表登记信息。" />;
  if (module.error) return <ErrorState title="码值表加载失败" desc={module.error} onRetry={module.load} />;

  const stats = [
    ["码表总数", module.items.length],
    ["启用", module.items.filter((item) => item.status === "enabled").length],
    ["禁用", module.items.filter((item) => item.status === "disabled").length],
    ["样式种类", new Set(module.items.map((item) => item.style)).size],
  ];

  return (
    <div className="asset-page code-table-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">CODE</span>码值表维护</div>
          <div className="page-sub">注册并维护湖仓手工码值表的表级元数据，不维护表内码值条目。</div>
        </div>
        <div className="head-actions">
          <button className="btn" type="button" onClick={module.exportCsv}><Icon name="download" size={15} />导出</button>
          {canEdit ? <button className="btn primary" type="button" onClick={module.openNew}><Icon name="plus" size={15} />新增码值表</button> : null}
        </div>
      </div>

      <div className="stat-row">{stats.map(([label, value]) => <div className="stat-card" key={label}><div className="sv">{value}</div><div className="sl">{label}</div></div>)}</div>

      <div className="tbl-wrap code-table-list">
        <div className="field-toolbar">
          <select className="inp code-table-status-filter" value={module.statusFilter} onChange={(event) => module.setStatusFilter(event.target.value)} aria-label="状态筛选">
            <option value="">全部状态</option><option value="enabled">启用</option><option value="disabled">禁用</option>
          </select>
          <div className="ft-info">共 {module.filteredItems.length} 张码表{query ? `，匹配“${query}”` : ""}</div>
        </div>
        {!module.filteredItems.length ? (
          <EmptyState title="暂无匹配的手工码值表" desc="请调整搜索或筛选条件，管理员也可以新增一张码值表。" actionText={canEdit ? "新增码值表" : ""} onAction={canEdit ? module.openNew : undefined} />
        ) : (
          <table className="dt mobile-card-table">
            <thead><tr><th>表编码</th><th>表名称</th><th>表样式</th><th>负责人</th><th>状态</th><th>更新时间</th><th>说明</th><th>操作</th></tr></thead>
            <tbody>{module.filteredItems.map((item) => (
              <tr key={item.id}>
                <td data-label="表编码" className="mono"><Highlight text={item.tableCode} q={query} /></td>
                <td data-label="表名称"><Highlight text={item.tableName} q={query} /></td>
                <td data-label="表样式"><span className="tag tag-neutral">{STYLE_LABELS[item.style] || item.style}</span></td>
                <td data-label="负责人"><Highlight text={item.owner || "-"} q={query} /></td>
                <td data-label="状态"><StatusBadge status={item.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></td>
                <td data-label="更新时间" className="mono">{formatDateTime(item.updatedAt)}</td>
                <td data-label="说明"><span className="system-line-clamp"><Highlight text={item.remark || "-"} q={query} /></span></td>
                <td data-label="" className="mobile-card-actions">
                  <RowActions
                    onView={() => module.setDetailItem(item)}
                    onEdit={canEdit ? () => module.openEdit(item) : undefined}
                    toggle={canEdit ? { enabled: item.status === "enabled", label: item.tableName, onToggle: () => module.changeStatus(item, item.status === "enabled" ? "disabled" : "enabled") } : undefined}
                  />
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <FormModal open={module.formModal.open} title={module.formModal.mode === "edit" ? "编辑码值表" : "新增码值表"} subtitle={module.formModal.mode === "edit" ? `正在编辑：${module.formModal.initial?.tableCode}` : "登记一张湖仓手工码值表"} icon="table" onClose={module.closeForm} onSubmit={module.submit} submitText={module.formModal.mode === "edit" ? "保存修改" : "创建"} busy={module.formModal.busy}>
        <CodeTableForm module={module} />
      </FormModal>
      <DetailModal item={module.detailItem} onClose={() => module.setDetailItem(null)} onEdit={module.openEdit} canEdit={canEdit} />
    </div>
  );
}
